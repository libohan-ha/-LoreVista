import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Story(Base):
    __tablename__ = "stories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="未命名故事")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, default="")
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ref_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    character_profiles: Mapped[str | None] = mapped_column(Text, nullable=True, default="")
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, server_default=func.now())

    chapters: Mapped[list["Chapter"]] = relationship("Chapter", back_populates="story", order_by="Chapter.chapter_number", cascade="all, delete-orphan")

    @property
    def has_character_profiles(self) -> bool:
        return bool((self.character_profiles or "").strip())


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("story_id", "chapter_number", name="uq_chapters_story_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(Integer, ForeignKey("stories.id"), nullable=False)
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    novel_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scenes_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    character_profiles: Mapped[str | None] = mapped_column(Text, nullable=True)
    ref_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    color_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    image_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, server_default=func.now())

    story: Mapped["Story"] = relationship("Story", back_populates="chapters")
    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="chapter", order_by="ChatMessage.created_at", cascade="all, delete-orphan")
    images: Mapped[list["MangaImage"]] = relationship("MangaImage", back_populates="chapter", order_by="MangaImage.image_number", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(Integer, ForeignKey("chapters.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, server_default=func.now())

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="messages")


class MangaImage(Base):
    __tablename__ = "manga_images"
    __table_args__ = (UniqueConstraint("chapter_id", "image_number", name="uq_manga_images_chapter_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(Integer, ForeignKey("chapters.id"), nullable=False)
    image_number: Mapped[int] = mapped_column(Integer, nullable=False)
    image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, server_default=func.now())

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="images")
