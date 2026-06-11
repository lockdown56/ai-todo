from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)

    lists: Mapped[list[TaskList]] = relationship(back_populates="user")
    tasks: Mapped[list[Task]] = relationship(back_populates="user")
    tags: Mapped[list[Tag]] = relationship(back_populates="user")


class TaskList(TimestampMixin, Base):
    __tablename__ = "task_lists"
    __table_args__ = (
        CheckConstraint("system_type IS NULL OR system_type = 'inbox'", name="ck_list_system_type"),
        Index("ix_lists_user_deleted_sort", "user_id", "deleted_at", "sort_order"),
        Index(
            "uq_active_inbox_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("system_type = 'inbox' AND deleted_at IS NULL"),
            sqlite_where=text("system_type = 'inbox' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6C5CE7")
    system_type: Mapped[str | None] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_batch_id: Mapped[UUID | None]

    user: Mapped[User] = relationship(back_populates="lists")
    tasks: Mapped[list[Task]] = relationship(back_populates="task_list")


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("priority IN (0, 1, 3, 5)", name="ck_task_priority"),
        CheckConstraint("status IN (0, 2)", name="ck_task_status"),
        Index("ix_tasks_user_deleted_status", "user_id", "deleted_at", "status"),
        Index("ix_tasks_user_list_deleted_sort", "user_id", "list_id", "deleted_at", "sort_order"),
        Index("ix_tasks_user_due_deleted_status", "user_id", "due_at", "deleted_at", "status"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    list_id: Mapped[UUID] = mapped_column(ForeignKey("task_lists.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sort_order: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_batch_id: Mapped[UUID | None]

    user: Mapped[User] = relationship(back_populates="tasks")
    task_list: Mapped[TaskList] = relationship(back_populates="tasks")
    checklist_items: Mapped[list[ChecklistItem]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="ChecklistItem.sort_order",
    )
    tags: Mapped[list[Tag]] = relationship(
        secondary="task_tags",
        back_populates="tasks",
        lazy="selectin",
    )


class ChecklistItem(TimestampMixin, Base):
    __tablename__ = "checklist_items"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(BigInteger, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    task: Mapped[Task] = relationship(back_populates="checklist_items")


class Tag(TimestampMixin, Base):
    __tablename__ = "tags"
    __table_args__ = (
        Index("uq_tags_user_lower_name", "user_id", text("lower(name)"), unique=True),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6C5CE7")

    user: Mapped[User] = relationship(back_populates="tags")
    tasks: Mapped[list[Task]] = relationship(
        secondary="task_tags",
        back_populates="tags",
    )


class TaskTag(Base):
    __tablename__ = "task_tags"
    __table_args__ = (UniqueConstraint("task_id", "tag_id"),)

    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )
