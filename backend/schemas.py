from __future__ import annotations

import datetime
from typing import Optional
from pathlib import Path

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
            d['has_ref_image'] = bool(ref_image and (Path(__file__).resolve().parent / ref_image).exists())
            return d
        return data


# --- Chapter ---
class ChapterOut(BaseModel):
    id: int
    story_id: int
    chapter_number: int
    novel_content: Optional[str] = None
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
