import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from database import get_db, init_db
from models import Chapter, ChatMessage, MangaImage, Story
from schemas import (
    ChapterOut,
    ChatMessageIn,
    ChatMessageOut,
    MangaImageOut,
    StoryCreate,
    StoryOut,
)
from services.deepseek import chat_stream, generate_novel, split_scenes
from services.image2 import generate_manga_image

load_dotenv()

app = FastAPI(title="Novel & Manga Generator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated manga images as static files
manga_dir = Path(__file__).resolve().parent / "manga_outputs"
manga_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/manga", StaticFiles(directory=str(manga_dir)), name="manga")


@app.on_event("startup")
def on_startup():
    init_db()


# ─── Story CRUD ─────────────────────────────────────────────

@app.post("/api/stories", response_model=StoryOut)
def create_story(body: StoryCreate, db: Session = Depends(get_db)):
    story = Story(title=body.title)
    db.add(story)
    db.flush()
    # Auto-create first chapter
    chapter = Chapter(story_id=story.id, chapter_number=1)
    db.add(chapter)
    db.commit()
    db.refresh(story)
    return story


@app.get("/api/stories", response_model=list[StoryOut])
def list_stories(db: Session = Depends(get_db)):
    return db.query(Story).order_by(Story.created_at.desc()).all()


@app.get("/api/stories/{story_id}", response_model=StoryOut)
def get_story(story_id: int, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    return story


# ─── Chapter CRUD ───────────────────────────────────────────

@app.get("/api/stories/{story_id}/chapters", response_model=list[ChapterOut])
def list_chapters(story_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Chapter)
        .filter(Chapter.story_id == story_id)
        .order_by(Chapter.chapter_number)
        .all()
    )


@app.get("/api/chapters/{chapter_id}", response_model=ChapterOut)
def get_chapter(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    return chapter


@app.post("/api/stories/{story_id}/chapters", response_model=ChapterOut)
def create_next_chapter(story_id: int, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    max_num = (
        db.query(Chapter.chapter_number)
        .filter(Chapter.story_id == story_id)
        .order_by(Chapter.chapter_number.desc())
        .first()
    )
    next_num = (max_num[0] + 1) if max_num else 1
    chapter = Chapter(story_id=story_id, chapter_number=next_num)
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


@app.delete("/api/chapters/{chapter_id}")
def delete_chapter(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    # Delete image files from disk
    chapter_dir = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}"
    if chapter_dir.exists():
        import shutil
        shutil.rmtree(chapter_dir)

    # Delete DB records (messages + images cascade via relationship, or manually)
    for img in chapter.images:
        db.delete(img)
    for msg in chapter.messages:
        db.delete(msg)
    db.delete(chapter)
    db.commit()
    return {"ok": True}


# ─── Chat (SSE streaming) ──────────────────────────────────

@app.post("/api/chapters/{chapter_id}/chat")
async def chat(chapter_id: int, body: ChatMessageIn, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    # Save user message
    user_msg = ChatMessage(chapter_id=chapter_id, role="user", content=body.content)
    db.add(user_msg)
    db.commit()

    # Build message history including all previous chapters in same story
    all_chapters = (
        db.query(Chapter)
        .filter(Chapter.story_id == chapter.story_id, Chapter.chapter_number <= chapter.chapter_number)
        .order_by(Chapter.chapter_number)
        .all()
    )
    history = []
    for ch in all_chapters:
        for m in ch.messages:
            history.append({"role": m.role, "content": m.content})

    collected: list[str] = []

    async def event_generator():
        try:
            async for token in chat_stream(history):
                collected.append(token)
                yield {"event": "token", "data": json.dumps({"content": token}, ensure_ascii=False)}
            # Save assistant message
            full_content = "".join(collected)
            assistant_msg = ChatMessage(chapter_id=chapter_id, role="assistant", content=full_content)
            db.add(assistant_msg)
            db.commit()
            yield {"event": "done", "data": json.dumps({"content": full_content}, ensure_ascii=False)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)}, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


# ─── Generate Novel ─────────────────────────────────────────

@app.post("/api/chapters/{chapter_id}/generate-novel", response_model=ChapterOut)
async def generate_novel_endpoint(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    history = [{"role": m.role, "content": m.content} for m in chapter.messages]
    if not history:
        raise HTTPException(400, "No chat history to generate novel from")

    novel_content = await generate_novel(history)
    chapter.novel_content = novel_content

    # Also save as assistant message
    msg = ChatMessage(chapter_id=chapter_id, role="assistant", content=novel_content)
    db.add(msg)
    db.commit()
    db.refresh(chapter)
    return chapter


# ─── Character Profiles ───────────────────────────────────

def _characters_path(chapter_id: int) -> Path:
    return Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "characters.txt"


def _load_characters(chapter_id: int) -> str:
    p = _characters_path(chapter_id)
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return ""


@app.get("/api/chapters/{chapter_id}/characters")
async def get_characters(chapter_id: int):
    return {"characters": _load_characters(chapter_id)}


@app.put("/api/chapters/{chapter_id}/characters")
async def save_characters(chapter_id: int, body: dict):
    text = body.get("characters", "").strip()
    p = _characters_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return {"ok": True}


# ─── Generate Manga ─────────────────────────────────────────

@app.post("/api/chapters/{chapter_id}/generate-manga")
async def generate_manga_endpoint(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if not chapter.novel_content:
        raise HTTPException(400, "No novel content to generate manga from. Generate novel first.")

    # Step 1: Split novel into 10 scene descriptions
    scenes = await split_scenes(chapter.novel_content)

    # Step 2: Generate images for each scene (sequential to avoid rate limits)
    results: list[dict] = []
    for i, scene_prompt in enumerate(scenes, start=1):
        image_path = await generate_manga_image(scene_prompt, chapter_id, i, character_profiles=_load_characters(chapter_id))
        manga = MangaImage(
            chapter_id=chapter_id,
            image_number=i,
            image_path=image_path,
            prompt=scene_prompt,
        )
        db.add(manga)
        db.commit()
        db.refresh(manga)
        results.append({
            "id": manga.id,
            "image_number": i,
            "image_path": image_path,
            "prompt": scene_prompt,
        })

    return {"images": results}


# ─── Scene generation & management ───────────────────────

@app.post("/api/chapters/{chapter_id}/generate-scenes")
async def generate_scenes_endpoint(chapter_id: int, db: Session = Depends(get_db)):
    """Generate 10 scene prompts from chat history. Returns them for user review."""
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if not chapter.messages:
        raise HTTPException(400, "No chat messages yet")

    chat_history = [{"role": m.role, "content": m.content} for m in chapter.messages]
    scenes = await split_scenes(chat_history, character_profiles=_load_characters(chapter_id))

    # Save to file
    prompts_dir = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    prompts_file = prompts_dir / "scenes.txt"
    with open(prompts_file, "w", encoding="utf-8") as f:
        for idx, s in enumerate(scenes, 1):
            f.write(f"=== 第{idx}格 ===\n{s}\n\n")

    return {"scenes": scenes}


@app.get("/api/chapters/{chapter_id}/scenes")
async def get_scenes_endpoint(chapter_id: int):
    """Load saved scene prompts from file."""
    prompts_file = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "scenes.txt"
    if not prompts_file.exists():
        return {"scenes": []}
    try:
        import re
        raw = prompts_file.read_text(encoding="utf-8")
        parts = re.split(r"=== 第\d+格 ===\n", raw)
        parts = [p.strip() for p in parts if p.strip()]
        return {"scenes": parts}
    except Exception:
        return {"scenes": []}


@app.put("/api/chapters/{chapter_id}/scenes")
async def update_scenes_endpoint(chapter_id: int, body: dict):
    """Save user-edited scene prompts."""
    scenes = body.get("scenes", [])
    if len(scenes) != 10:
        raise HTTPException(400, "Must provide exactly 10 scenes")

    prompts_dir = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    prompts_file = prompts_dir / "scenes.txt"
    with open(prompts_file, "w", encoding="utf-8") as f:
        for idx, s in enumerate(scenes, 1):
            f.write(f"=== 第{idx}格 ===\n{s}\n\n")

    return {"ok": True}


# ─── SSE for manga image generation ─────────────────────

@app.post("/api/chapters/{chapter_id}/generate-manga-stream")
async def generate_manga_stream(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    # Load scenes from file (must exist - user should generate/confirm scenes first)
    import re
    prompts_file = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "scenes.txt"
    if not prompts_file.exists():
        raise HTTPException(400, "No scene prompts found. Generate scenes first.")
    raw = prompts_file.read_text(encoding="utf-8")
    parts = re.split(r"=== 第\d+格 ===\n", raw)
    scenes = [p.strip() for p in parts if p.strip()]
    if len(scenes) != 10:
        raise HTTPException(400, f"Expected 10 scenes, found {len(scenes)}")

    # Check which images already exist
    existing_images = {img.image_number: img for img in chapter.images}

    async def event_generator():
        try:
            yield {"event": "scenes", "data": json.dumps({"scenes": scenes}, ensure_ascii=False)}

            for i, scene_prompt in enumerate(scenes, start=1):
                # Skip already generated images
                if i in existing_images:
                    img = existing_images[i]
                    yield {
                        "event": "image",
                        "data": json.dumps({
                            "id": img.id,
                            "image_number": i,
                            "image_path": img.image_path,
                            "prompt": img.prompt or scene_prompt,
                        }, ensure_ascii=False),
                    }
                    continue

                yield {
                    "event": "progress",
                    "data": json.dumps({"current": i, "total": 10, "prompt": scene_prompt}, ensure_ascii=False),
                }

                try:
                    image_path = await generate_manga_image(scene_prompt, chapter_id, i, all_scenes=scenes, character_profiles=_load_characters(chapter_id))
                except Exception as img_err:
                    yield {
                        "event": "error",
                        "data": json.dumps({"error": f"第{i}张生成失败: {img_err}"}, ensure_ascii=False),
                    }
                    return

                manga = MangaImage(
                    chapter_id=chapter_id,
                    image_number=i,
                    image_path=image_path,
                    prompt=scene_prompt,
                )
                db.add(manga)
                db.commit()
                db.refresh(manga)
                yield {
                    "event": "image",
                    "data": json.dumps({
                        "id": manga.id,
                        "image_number": i,
                        "image_path": image_path,
                        "prompt": scene_prompt,
                    }, ensure_ascii=False),
                }

            yield {"event": "done", "data": json.dumps({"message": "漫画生成完成！"}, ensure_ascii=False)}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)}, ensure_ascii=False)}

    return EventSourceResponse(event_generator(), ping=10)


# ─── Download all images as zip ──────────────────────────

@app.get("/api/chapters/{chapter_id}/download-images")
async def download_images(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if not chapter.images:
        raise HTTPException(400, "No images to download")

    import io
    import zipfile
    from fastapi.responses import StreamingResponse

    buf = io.BytesIO()
    chapter_dir = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for img in sorted(chapter.images, key=lambda x: x.image_number):
            img_path = Path(__file__).resolve().parent / img.image_path
            if img_path.exists():
                zf.write(img_path, f"panel_{img.image_number:02d}.png")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=chapter_{chapter.chapter_number}_manga.zip"},
    )


# ─── Regenerate single image ─────────────────────────────

@app.post("/api/chapters/{chapter_id}/regenerate-image/{image_number}")
async def regenerate_single_image(chapter_id: int, image_number: int, body: dict, db: Session = Depends(get_db)):
    """Regenerate a single panel image with an updated prompt."""
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if image_number < 1 or image_number > 10:
        raise HTTPException(400, "image_number must be 1-10")

    prompt = body.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")

    # Load all scenes for context
    import re as _re
    prompts_file = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "scenes.txt"
    all_scenes = None
    if prompts_file.exists():
        raw = prompts_file.read_text(encoding="utf-8")
        parts = _re.split(r"=== 第\d+格 ===\n", raw)
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) == 10:
            # Update the scene in file
            parts[image_number - 1] = prompt
            all_scenes = parts
            with open(prompts_file, "w", encoding="utf-8") as f:
                for idx, s in enumerate(parts, 1):
                    f.write(f"=== 第{idx}格 ===\n{s}\n\n")

    # Delete old DB record for this image_number
    old_img = db.query(MangaImage).filter(
        MangaImage.chapter_id == chapter_id,
        MangaImage.image_number == image_number,
    ).first()
    if old_img:
        # Delete old file
        old_path = Path(__file__).resolve().parent / old_img.image_path
        if old_path.exists():
            old_path.unlink()
        db.delete(old_img)
        db.commit()

    # Generate new image
    image_path = await generate_manga_image(prompt, chapter_id, image_number, all_scenes=all_scenes, character_profiles=_load_characters(chapter_id))

    manga = MangaImage(
        chapter_id=chapter_id,
        image_number=image_number,
        image_path=image_path,
        prompt=prompt,
    )
    db.add(manga)
    db.commit()
    db.refresh(manga)

    return {
        "id": manga.id,
        "image_number": image_number,
        "image_path": image_path,
        "prompt": prompt,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
