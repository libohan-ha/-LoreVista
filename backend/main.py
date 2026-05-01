import asyncio
import contextlib
import json
import logging
import os
import shutil
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
ACTIVE_MANGA_GENERATIONS: set[int] = set()

app = FastAPI(title="Novel & Manga Generator")

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_CHARACTER_PROFILE_CHARS = int(os.getenv("MAX_CHARACTER_PROFILE_CHARS", "20000"))
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


def _character_profile_text(body: dict) -> str:
    raw = body.get("characters", "")
    if not isinstance(raw, str):
        raise HTTPException(400, "characters must be a string")
    text = raw.strip()
    if len(text) > MAX_CHARACTER_PROFILE_CHARS:
        raise HTTPException(413, f"Character profile is too long. Max length is {MAX_CHARACTER_PROFILE_CHARS} characters")
    return text


def _unlink_file(path: Path, label: str) -> None:
    if not path.exists():
        return
    try:
        path.unlink()
    except OSError as exc:
        logger.warning("Failed to delete %s %s: %s", label, path, exc)
        raise HTTPException(409, f"{label} file is currently in use. Try again later")


def _rmtree_best_effort(path: Path, label: str) -> None:
    if not path.exists():
        return
    try:
        shutil.rmtree(path)
    except OSError as exc:
        logger.warning("Failed to delete %s %s: %s", label, path, exc)


def _write_bytes_or_conflict(path: Path, data: bytes, label: str) -> None:
    try:
        path.write_bytes(data)
    except OSError as exc:
        logger.warning("Failed to write %s %s: %s", label, path, exc)
        raise HTTPException(409, f"{label} file is currently in use. Try again later")


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
    for chapter in story.chapters:
        chapter_dir = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter.id}"
        _rmtree_best_effort(chapter_dir, "chapter directory")
        for img in chapter.images:
            db.delete(img)
        for msg in chapter.messages:
            db.delete(msg)
        db.delete(chapter)
    if story.cover_image:
        cover_path = Path(__file__).resolve().parent / story.cover_image
        try:
            _unlink_file(cover_path, "story cover")
        except HTTPException:
            logger.warning("Story cover remained after story deletion: %s", cover_path)
    story_dir = Path(__file__).resolve().parent / "manga_outputs" / f"story_{story_id}"
    _rmtree_best_effort(story_dir, "story asset directory")
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
    _write_bytes_or_conflict(covers_dir / filename, img_bytes, "story cover")
    # Delete old cover file if exists
    if story.cover_image:
        old = Path(__file__).resolve().parent / story.cover_image
        try:
            _unlink_file(old, "old story cover")
        except HTTPException:
            logger.warning("Old story cover remained after replacement: %s", old)
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
    _rmtree_best_effort(chapter_dir, "chapter directory")

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

    def save_interrupted_assistant() -> None:
        full_content = "".join(collected).strip()
        if not full_content:
            return
        assistant_msg = ChatMessage(
            chapter_id=chapter_id,
            role="assistant",
            content=f"{full_content}\n\n[已中止]",
        )
        db.add(assistant_msg)
        db.commit()

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
        except asyncio.CancelledError:
            db.rollback()
            save_interrupted_assistant()
            raise
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


def _load_characters(chapter_id: int, db: Session | None = None) -> str:
    """Load character profiles: chapter-level file first, then fallback to story-level."""
    p = _characters_path(chapter_id)
    if p.exists():
        text = p.read_text(encoding="utf-8").strip()
        if text:
            return text
    # Fallback to story-level
    if db:
        chapter = db.get(Chapter, chapter_id)
        if chapter and chapter.story and chapter.story.character_profiles:
            return chapter.story.character_profiles.strip()
    return ""


def _has_chapter_characters(chapter_id: int) -> bool:
    """Check if chapter has its own character file (not inherited)."""
    p = _characters_path(chapter_id)
    return p.exists() and bool(p.read_text(encoding="utf-8").strip())


# Story-level character profiles
@app.get("/api/stories/{story_id}/characters")
async def get_story_characters(story_id: int, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    return {"characters": (story.character_profiles or "").strip()}


@app.put("/api/stories/{story_id}/characters")
async def save_story_characters(story_id: int, body: dict, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    story.character_profiles = _character_profile_text(body)
    db.commit()
    return {"ok": True}


# Chapter-level character profiles (with fallback info)
@app.get("/api/chapters/{chapter_id}/characters")
async def get_characters(chapter_id: int, db: Session = Depends(get_db)):
    chapter = _require_chapter(chapter_id, db)
    has_own = _has_chapter_characters(chapter_id)
    if has_own:
        text = _characters_path(chapter_id).read_text(encoding="utf-8").strip()
    else:
        text = (chapter.story.character_profiles or "").strip() if chapter.story else ""
    return {"characters": text, "source": "chapter" if has_own else ("story" if text else "none")}


@app.put("/api/chapters/{chapter_id}/characters")
async def save_characters(chapter_id: int, body: dict, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    text = _character_profile_text(body)
    p = _characters_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return {"ok": True}


@app.delete("/api/chapters/{chapter_id}/characters")
async def reset_chapter_characters(chapter_id: int, db: Session = Depends(get_db)):
    """Delete chapter-level override so it falls back to story-level."""
    _require_chapter(chapter_id, db)
    p = _characters_path(chapter_id)
    _unlink_file(p, "character profile")
    return {"ok": True}


# ─── Reference Image (垫图) ─────────────────────────────────

def _story_ref_image_path(story_id: int) -> Path:
    return Path(__file__).resolve().parent / "manga_outputs" / f"story_{story_id}" / "ref_image.png"


def _chapter_ref_image_path(chapter_id: int) -> Path:
    return Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "ref_image.png"


def _story_ref_image_static_path(story_id: int) -> str:
    return f"manga_outputs/story_{story_id}/ref_image.png"


def _effective_ref_image_path(chapter_id: int, db: Session) -> Path | None:
    """Return the effective ref image path: chapter-level first, then story-level fallback."""
    cp = _chapter_ref_image_path(chapter_id)
    if cp.exists():
        return cp
    chapter = db.get(Chapter, chapter_id)
    if chapter:
        sp = _story_ref_image_path(chapter.story_id)
        if sp.exists():
            return sp
    return None


# Story-level ref image
@app.get("/api/stories/{story_id}/ref-image")
async def get_story_ref_image(story_id: int, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    p = _story_ref_image_path(story_id)
    if p.exists():
        return {"has_ref": True, "size_kb": round(p.stat().st_size / 1024), "image_path": _story_ref_image_static_path(story_id)}
    return {"has_ref": False}


@app.post("/api/stories/{story_id}/ref-image")
async def upload_story_ref_image(story_id: int, request: Request, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    body = await request.json()
    b64 = body.get("image", "")
    img_bytes = _decode_png_upload(b64)
    p = _story_ref_image_path(story_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    _write_bytes_or_conflict(p, img_bytes, "story ref image")
    return {"ok": True, "size_kb": round(len(img_bytes) / 1024), "image_path": _story_ref_image_static_path(story_id)}


@app.delete("/api/stories/{story_id}/ref-image")
async def delete_story_ref_image(story_id: int, db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")
    p = _story_ref_image_path(story_id)
    _unlink_file(p, "story ref image")
    return {"ok": True}


# Chapter-level ref image (with fallback)
@app.get("/api/chapters/{chapter_id}/ref-image")
async def get_ref_image(chapter_id: int, db: Session = Depends(get_db)):
    chapter = _require_chapter(chapter_id, db)
    cp = _chapter_ref_image_path(chapter_id)
    if cp.exists():
        return {"has_ref": True, "source": "chapter", "size_kb": round(cp.stat().st_size / 1024)}
    sp = _story_ref_image_path(chapter.story_id)
    if sp.exists():
        return {"has_ref": True, "source": "story", "size_kb": round(sp.stat().st_size / 1024)}
    return {"has_ref": False, "source": "none"}


@app.post("/api/chapters/{chapter_id}/ref-image")
async def upload_ref_image(chapter_id: int, request: Request, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    body = await request.json()
    b64 = body.get("image", "")
    img_bytes = _decode_png_upload(b64)
    p = _chapter_ref_image_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    _write_bytes_or_conflict(p, img_bytes, "chapter ref image")
    return {"ok": True, "size_kb": round(len(img_bytes) / 1024)}


@app.delete("/api/chapters/{chapter_id}/ref-image")
async def delete_ref_image(chapter_id: int, db: Session = Depends(get_db)):
    """Delete chapter-level ref image override so it falls back to story-level."""
    _require_chapter(chapter_id, db)
    p = _chapter_ref_image_path(chapter_id)
    _unlink_file(p, "chapter ref image")
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


# ─── Image Count ───────────────────────────────────────────

DEFAULT_IMAGE_COUNT = 10
ALLOWED_IMAGE_COUNTS = [4, 6, 8, 10, 12, 15, 20]


def _image_count_path(chapter_id: int) -> Path:
    return Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "image_count.txt"


def _load_image_count(chapter_id: int) -> int:
    p = _image_count_path(chapter_id)
    if p.exists():
        try:
            v = int(p.read_text(encoding="utf-8").strip())
            if v in ALLOWED_IMAGE_COUNTS:
                return v
        except (ValueError, OSError):
            pass
    return DEFAULT_IMAGE_COUNT


def _chapter_has_scene_file(chapter_id: int) -> bool:
    prompts_file = Path(__file__).resolve().parent / "manga_outputs" / f"chapter_{chapter_id}" / "scenes.txt"
    if not prompts_file.exists():
        return False
    try:
        return bool(prompts_file.read_text(encoding="utf-8").strip())
    except OSError:
        return True


@app.get("/api/chapters/{chapter_id}/image-count")
async def get_image_count(chapter_id: int, db: Session = Depends(get_db)):
    _require_chapter(chapter_id, db)
    return {"image_count": _load_image_count(chapter_id)}


@app.put("/api/chapters/{chapter_id}/image-count")
async def set_image_count(chapter_id: int, body: dict, db: Session = Depends(get_db)):
    chapter = _require_chapter(chapter_id, db)
    if chapter.images or _chapter_has_scene_file(chapter_id):
        raise HTTPException(409, "Cannot change image count after scenes or images have been created")
    count = body.get("image_count", DEFAULT_IMAGE_COUNT)
    if count not in ALLOWED_IMAGE_COUNTS:
        raise HTTPException(400, f"image_count must be one of {ALLOWED_IMAGE_COUNTS}")
    p = _image_count_path(chapter_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(count), encoding="utf-8")
    return {"ok": True}


# ─── Scene generation & management ───────────────────────

@app.post("/api/chapters/{chapter_id}/generate-scenes")
async def generate_scenes_endpoint(chapter_id: int, request: Request, db: Session = Depends(get_db)):
    """Generate scene prompts from chat history. Returns them for user review."""
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if not chapter.messages:
        raise HTTPException(400, "No chat messages yet")

    image_count = _load_image_count(chapter_id)
    chat_history = [{"role": m.role, "content": m.content} for m in chapter.messages]
    split_task = asyncio.create_task(
        split_scenes(chat_history, character_profiles=_load_characters(chapter_id, db), page_count=image_count)
    )
    try:
        while not split_task.done():
            if await request.is_disconnected():
                split_task.cancel()
                raise HTTPException(499, "Scene generation was cancelled")
            await asyncio.sleep(0.25)
        scenes = await split_task
        if await request.is_disconnected():
            raise HTTPException(499, "Scene generation was cancelled")
    except ValueError as exc:
        logger.warning("Failed to parse scene split response for chapter %s: %s", chapter_id, exc)
        raise HTTPException(502, "AI returned invalid scene JSON. Please retry generating scenes.")
    except asyncio.CancelledError:
        raise HTTPException(499, "Scene generation was cancelled")
    finally:
        if not split_task.done():
            split_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await split_task

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
    image_count = _load_image_count(chapter_id)
    if not isinstance(scenes, list) or len(scenes) != image_count or not all(isinstance(s, str) and s.strip() for s in scenes):
        raise HTTPException(400, f"Must provide exactly {image_count} scenes")

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
    image_count = _load_image_count(chapter_id)
    raw = prompts_file.read_text(encoding="utf-8")
    parts = re.split(r"=== 第\d+格 ===\n", raw)
    scenes = [p.strip() for p in parts if p.strip()]
    if len(scenes) != image_count:
        raise HTTPException(400, f"Expected {image_count} scenes, found {len(scenes)}")
    if chapter_id in ACTIVE_MANGA_GENERATIONS:
        raise HTTPException(409, "Manga generation is already running for this chapter")
    ACTIVE_MANGA_GENERATIONS.add(chapter_id)

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
                    "data": json.dumps({"current": i, "total": image_count, "prompt": scene_prompt}, ensure_ascii=False),
                }

                try:
                    ref_img = _effective_ref_image_path(chapter_id, db)
                    image_path = await generate_manga_image(scene_prompt, chapter_id, i, all_scenes=scenes, character_profiles=_load_characters(chapter_id, db), ref_image_path=str(ref_img) if ref_img else None, color_mode=_load_color_mode(chapter_id))
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
        finally:
            ACTIVE_MANGA_GENERATIONS.discard(chapter_id)

    return EventSourceResponse(event_generator(), ping=10)


# ─── Regenerate single image ─────────────────────────────

@app.post("/api/chapters/{chapter_id}/regenerate-image/{image_number}")
async def regenerate_single_image(chapter_id: int, image_number: int, body: dict, db: Session = Depends(get_db)):
    """Regenerate a single panel image with an updated prompt."""
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    image_count = _load_image_count(chapter_id)
    if image_number < 1 or image_number > image_count:
        raise HTTPException(400, f"image_number must be 1-{image_count}")

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
        if len(parts) == image_count:
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
    ref_img = _effective_ref_image_path(chapter_id, db)
    image_path = await generate_manga_image(prompt, chapter_id, image_number, all_scenes=all_scenes, character_profiles=_load_characters(chapter_id, db), ref_image_path=str(ref_img) if ref_img else None, color_mode=_load_color_mode(chapter_id))

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
