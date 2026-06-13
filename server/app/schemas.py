from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AuthLogin(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=500)


class AuthUserResponse(BaseModel):
    id: UUID
    username: str
    display_name: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    expires_at: datetime
    user: AuthUserResponse


class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#6C5CE7", pattern=HEX_COLOR)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("清单名称不能为空")
        return cleaned


class ListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    sort_order: int | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not (value := value.strip()):
            raise ValueError("清单名称不能为空")
        return value


class ListResponse(ApiModel):
    id: UUID
    name: str
    color: str
    system_type: str | None
    sort_order: int
    task_count: int = 0
    deleted_at: datetime | None
    deletion_batch_id: UUID | None
    created_at: datetime
    updated_at: datetime


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    color: str = Field(default="#6C5CE7", pattern=HEX_COLOR)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("标签名称不能为空")
        return cleaned


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    color: str | None = Field(default=None, pattern=HEX_COLOR)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not (value := value.strip()):
            raise ValueError("标签名称不能为空")
        return value


class TagResponse(ApiModel):
    id: UUID
    name: str
    color: str
    created_at: datetime
    updated_at: datetime


class ChecklistCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("检查项标题不能为空")
        return cleaned


class ChecklistUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    is_completed: bool | None = None

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        if value is not None and not (value := value.strip()):
            raise ValueError("检查项标题不能为空")
        return value


class ChecklistResponse(ApiModel):
    id: UUID
    title: str
    is_completed: bool
    sort_order: int
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ChecklistReorder(BaseModel):
    item_ids: list[UUID]


class TaskFields(BaseModel):
    list_id: UUID | None = None
    title: str | None = Field(default=None, max_length=500)
    description: str | None = None
    due_at: datetime | None = None
    is_all_day: bool | None = None
    reminder_at: datetime | None = None
    priority: Literal[0, 1, 3, 5] | None = None
    sort_order: int | None = None
    tag_ids: list[UUID] | None = None

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskFields":
        if self.reminder_at and self.due_at and self.reminder_at > self.due_at:
            raise ValueError("提醒时间不得晚于截止时间")
        if self.reminder_at and self.due_at is None and "due_at" in self.model_fields_set:
            raise ValueError("设置提醒时间前必须先设置截止时间")
        return self


class TaskCreate(TaskFields):
    title: str = Field(max_length=500)
    checklist_items: list[ChecklistCreate] = Field(default_factory=list)


class TaskUpdate(TaskFields):
    pass


class TaskResponse(ApiModel):
    id: UUID
    list_id: UUID
    title: str
    description: str
    due_at: datetime | None
    is_all_day: bool
    reminder_at: datetime | None
    priority: int
    status: int
    completed_at: datetime | None
    sort_order: int
    deleted_at: datetime | None
    deletion_batch_id: UUID | None
    tags: list[TagResponse] = Field(default_factory=list)
    checklist_items: list[ChecklistResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TaskPage(BaseModel):
    items: list[TaskResponse]
    next_cursor: str | None


TaskView = Literal["inbox", "today", "all", "completed", "trash"]
TaskSort = Literal["manual", "created_asc", "created_desc", "due_asc", "priority_desc"]
