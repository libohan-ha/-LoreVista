import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
    StoryUpdate,
)
from services.deepseek import chat_stream, generate_novel, split_scenes
from services.image2 import generate_manga_image

load_dotenv()

logger = logging.getLogger("main")

app = FastAPI(title="Novel & Manga Generator")

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
API_TOKEN = os.getenv("API_TOKEN", "").strip()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated manga images as static files
manga_dir = Path(__file__).resolve().parent / "manga_outputs"
manga_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/manga", StaticFiles(directory=str(manga_dir)), name="manga")


@app.middleware("http")
async def require_api_token(request: Request, call_next):
    if API_TOKEN and request.url.path.startswith("/api") and request.method != "OPTIONS":
        supplied = request.headers.get("x-api-token", "")
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
        if supplied != API_TOKEN:
            return JSONResponse({"detail": "Invalid or missing API token"}, status_code=401)
    return await call_next(request)


def _require_chapter(chapter_id: int, db: Session) -> Chapter:
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    return chapter


def _decode_png_upload(b64: str) -> bytes:
    if not b64:
        raise HTTPException(400, "No image provided")
    if "," in b64 and b64.lstrip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        import base64
        import binascii
        import io

        from PIL import Image, UnidentifiedImageError

        img_bytes = base64.b64decode(b64, validate=True)
        if len(img_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"Image is too large. Max size is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
        with Image.open(io.BytesIO(img_bytes)) as img:
            img.verify()
        with Image.open(io.BytesIO(img_bytes)) as img:
            output = io.BytesIO()
            img.convert("RGBA").save(output, format="PNG", optimize=True)
            png_bytes = output.getvalue()
        if len(png_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"Image is too large after processing. Max size is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
        return png_bytes
    except HTTPException:
        raise
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Invalid base64 image data")
    except UnidentifiedImageError:
        raise HTTPException(400, "Uploaded file is not a valid image")


@app.on_event("startup")
def on_startup():
    init_db()
    # One-time: rename default stories
    from database import SessionLocal
    db = SessionLocal()
    try:
        for s in db.query(Story).filter(Story.title.in_(["我的第一个故事", "未命名故事"])).all():
            if s.chapters and any(ch.messages for ch in s.chapters):
                s.title = "转生成为暗恋公主的女仆故事"
                s.description = "百合女仆与公主的奇幻冒险"
            # else: leave as-is for empty stories
        db.commit()
    finally:
        db.close()


# ─── Story CRUD ─────────────────────────────────────────────

@app.post("/api/stories", response_model=StoryOut)
def create_story(body: StoryCreate, db: Session = Depends(get_db)):
    story = Story(title=body.title, description=body.description)
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


@app.put("/api/stories/{story_id}", response_model=StoryOut)
def update_story(story_id: int, body: StoryUpdate, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    if body.title is not None:
        story.title = body.title
    if body.description is not None:
        story.description = body.description
    db.commit()
    db.refresh(story)
    return story


@app.delete("/api/stories/{story_id}")
def delete_story(story_id: int, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    # Delete all chapters and their data
    import shutil
    for chapter in story.chapters:
        chapter_dir = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter.id}"
        if chapter_dir.exists():
            shutil.rmtree(chapter_dir)
        for img in chapter.images:
            db.delete(img)
        for msg in chapter.messages:
            db.delete(msg)
        db.delete(chapter)
    if story.cover_image:
        cover_path = Path(__file__).resolve().parent / story.cover_image
        if cover_path.exists():
            try:
                cover_path.unlink()
            except OSError as exc:
                logger.warning("Failed to delete story cover %s: %s", cover_path, exc)
    db.delete(story)
    db.commit()
    return {"ok": True}


@app.post("/api/stories/{story_id}/upload-cover")
async def upload_story_cover(story_id: int, request: Request, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    body = await request.json()
    b64 = body.get("image", "")
    import uuid
    img_bytes = _decode_png_upload(b64)
    covers_dir = manga_dir / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)
    filename = f"cover_{story_id}_{uuid.uuid4().hex[:8]}.png"
    (covers_dir / filename).write_bytes(img_bytes)
    # Delete old cover file if exists
    if story.cover_image:
        old = Path(__file__).resolve().parent / story.cover_image
        if old.exists():
            old.unlink(missing_ok=True)
    story.cover_image = f"manga_outputs/covers/{filename}"
    db.commit()
    db.refresh(story)
    return {"cover_image": story.cover_image}


# ─── Chapter CRUD ───────────────────────────────────────────

@app.get("/api/stories/{story_id}/chapters", response_model=list[ChapterOut])
def list_chapters(story_id: int, db: Session = Depends(get_db)):
    if not db.get(Story, story_id):
        raise HTTPException(404, "Story not found")
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
    story = (
        db.query(Story)
        .filter(Story.id == story_id)
        .with_for_update()
        .first()
    )
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
            db.rollback()
            persisted_user_msg = db.get(ChatMessage, user_msg.id)
            if persisted_user_msg:
                db.delete(persisted_user_msg)
                db.commit()
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
async def get_characters(chapter_id: int, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    return {"characters": _load_characters(chapter_id)}


@app.put("/api/chapters/{chapter_id}/characters")
async def save_characters(chapter_id: int, body: dict, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    text = body.get("characters", "").strip()
    p = _characters_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return {"ok": True}


# ─── Reference Image (垫图) ─────────────────────────────────

def _ref_image_path(chapter_id: int) -> Path:
    return Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "ref_image.png"


@app.get("/api/chapters/{chapter_id}/ref-image")
async def get_ref_image(chapter_id: int, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    p = _ref_image_path(chapter_id)
    if p.exists():
        return {"has_ref": True, "size_kb": round(p.stat().st_size / 1024)}
    return {"has_ref": False}


@app.post("/api/chapters/{chapter_id}/ref-image")
async def upload_ref_image(chapter_id: int, request: Request, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    body = await request.json()
    b64 = body.get("image", "")
    img_bytes = _decode_png_upload(b64)
    p = _ref_image_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(img_bytes)
    return {"ok": True, "size_kb": round(len(img_bytes) / 1024)}


@app.delete("/api/chapters/{chapter_id}/ref-image")
async def delete_ref_image(chapter_id: int, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    p = _ref_image_path(chapter_id)
    if p.exists():
        p.unlink()
    return {"ok": True}


# ─── Color Mode ─────────────────────────────────────────────

def _color_mode_path(chapter_id: int) -> Path:
    return Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "color_mode.txt"


def _load_color_mode(chapter_id: int) -> str:
    p = _color_mode_path(chapter_id)
    if p.exists():
        return p.read_text(encoding="utf-8").strip() or "bw"
    return "bw"


def _save_color_mode(chapter_id: int, mode: str):
    p = _color_mode_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(mode, encoding="utf-8")


@app.get("/api/chapters/{chapter_id}/color-mode")
async def get_color_mode(chapter_id: int, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    return {"color_mode": _load_color_mode(chapter_id)}


@app.put("/api/chapters/{chapter_id}/color-mode")
async def set_color_mode(chapter_id: int, body: dict, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    mode = body.get("color_mode", "bw")
    if mode not in ("bw", "color"):
        raise HTTPException(400, "color_mode must be 'bw' or 'color'")
    _save_color_mode(chapter_id, mode)
    return {"ok": True}


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
async def get_scenes_endpoint(chapter_id: int, db: Session = Depends(get_db)):
    """Load saved scene prompts from file."""
    _require_chapter(chapter_id, db)
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
async def update_scenes_endpoint(chapter_id: int, body: dict, db: Session = Depends(get_db)):
    """Save user-edited scene prompts."""
    _require_chapter(chapter_id, db)
    scenes = body.get("scenes", [])
    if not isinstance(scenes, list) or len(scenes) != 10 or not all(isinstance(s, str) and s.strip() for s in scenes):
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
                    ref_img = _ref_image_path(chapter_id)
                    image_path = await generate_manga_image(scene_prompt, chapter_id, i, all_scenes=scenes, character_profiles=_load_characters(chapter_id), ref_image_path=str(ref_img) if ref_img.exists() else None, color_mode=_load_color_mode(chapter_id))
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

    # Keep old DB/file intact until the new image is generated successfully.
    old_img = db.query(MangaImage).filter(
        MangaImage.chapter_id == chapter_id,
        MangaImage.image_number == image_number,
    ).first()
    old_path = Path(__file__).resolve().parent / old_img.image_path if old_img else None

    # Generate new image
    ref_img = _ref_image_path(chapter_id)
    image_path = await generate_manga_image(prompt, chapter_id, image_number, all_scenes=all_scenes, character_profiles=_load_characters(chapter_id), ref_image_path=str(ref_img) if ref_img.exists() else None, color_mode=_load_color_mode(chapter_id))

    if old_img:
        manga = old_img
        manga.image_path = image_path
        manga.prompt = prompt
    else:
        manga = MangaImage(
            chapter_id=chapter_id,
            image_number=image_number,
            image_path=image_path,
            prompt=prompt,
        )
        db.add(manga)
    db.commit()
    db.refresh(manga)

    if old_path and old_path.exists() and old_path != Path(__file__).resolve().parent / image_path:
        try:
            old_path.unlink()
        except OSError as exc:
            logger.warning("Failed to delete old regenerated image %s: %s", old_path, exc)

    return {
        "id": manga.id,
        "image_number": image_number,
        "image_path": image_path,
        "prompt": prompt,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "true").lower() == "true",
    )
