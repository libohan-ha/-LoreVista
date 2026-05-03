from __future__ import annotations

import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, model_validator


# --- Story ---
class StoryCreate(BaseModel):
    title: str = "未命名故事"
    description: str = ""


class StoryUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class StoryOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = ""
    cover_image: Optional[str] = None
    ref_image: Optional[str] = None
    has_character_profiles: bool = False
    has_ref_image: bool = False
    created_at: datetime.datetime

    model_config = {"from_attributes": True}

    @model_validator(mode='before')
    @classmethod
    def _extract_computed_flags(cls, data):
        if hasattr(data, 'character_profiles'):
            cp = getattr(data, 'character_profiles', '') or ''
            ref_image = getattr(data, 'ref_image', '') or ''
            d = dict(data.__dict__) if hasattr(data, '__dict__') else dict(data)
            d['has_character_profiles'] = bool(cp.strip())
            # Check DB ref_image field OR multi-ref dir on disk
            has_db_ref = bool(ref_image and (Path(__file__).resolve().parent / ref_image).exists())
            story_id = getattr(data, 'id', None)
            has_multi_ref = False
            has_legacy_ref = False
            if story_id:
                story_dir = Path(__file__).resolve().parent / "manga_outputs" / f"story_{story_id}"
                ref_dir = story_dir / "ref_images"
                has_multi_ref = ref_dir.exists() and any(
                    p.is_file() and p.suffix.lower() == ".png"
                    for p in ref_dir.iterdir()
                )
                has_legacy_ref = (story_dir / "ref_image.png").exists()
            d['has_ref_image'] = has_db_ref or has_multi_ref or has_legacy_ref
            return d
        return data


# --- Chapter ---
class ChapterOut(BaseModel):
    id: int
    story_id: int
    chapter_number: int
    novel_content: Optional[str] = None
    content_source: Optional[str] = None
    created_at: datetime.datetime
    messages: list[ChatMessageOut] = []
    images: list[MangaImageOut] = []

    model_config = {"from_attributes": True}


# --- Chat ---
class ChatMessageIn(BaseModel):
    content: str


class ChatMessageOut(BaseModel):
    id: int
    chapter_id: int
    role: str
    content: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# --- Manga ---
class MangaImageOut(BaseModel):
    id: int
    chapter_id: int
    image_number: int
    image_path: str
    prompt: Optional[str] = None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class GenerateNovelRequest(BaseModel):
    pass


class GenerateMangaRequest(BaseModel):
    pass


# Resolve forward references
ChapterOut.model_rebuild()
