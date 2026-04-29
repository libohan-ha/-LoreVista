from __future__ import annotations

import datetime
from typing import Optional

from pydantic import BaseModel


# --- Story ---
class StoryCreate(BaseModel):
    title: str = "未命名故事"


class StoryOut(BaseModel):
    id: int
    title: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


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
