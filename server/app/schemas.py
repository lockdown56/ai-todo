from datetime import UTC, date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AuthLogin(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=500)


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=500)


class AuthLogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=500)


class AuthUserResponse(BaseModel):
    id: UUID
    username: str
    display_name: str


ApiKeyScope = Literal["todo_full", "agent_reporter"]


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scope: ApiKeyScope = "todo_full"

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("API Key 名称不能为空")
        return cleaned


class ApiKeyResponse(ApiModel):
    id: UUID
    name: str
    key_prefix: str
    scope: str
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime


class ApiKeyCreatedResponse(ApiKeyResponse):
    api_key: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime
    user: AuthUserResponse


class ListGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("分组名称不能为空")
        return cleaned


class ListGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = None
    is_collapsed: bool | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is not None and not (value := value.strip()):
            raise ValueError("分组名称不能为空")
        return value


class ListGroupResponse(ApiModel):
    id: UUID
    name: str
    sort_order: int
    is_collapsed: bool
    created_at: datetime
    updated_at: datetime


class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#6C5CE7", pattern=HEX_COLOR)
    group_id: UUID | None = None

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
    group_id: UUID | None = None

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
    group_id: UUID | None
    sort_order: int
    task_count: int = 0
    archived_at: datetime | None
    deleted_at: datetime | None
    deletion_batch_id: UUID | None
    created_at: datetime
    updated_at: datetime


SmartListStatus = Literal["active", "completed"]
SmartListDateMode = Literal[
    "none", "overdue", "today", "tomorrow", "this_week", "next_7_days", "range"
]


class SmartListDateFilter(BaseModel):
    mode: SmartListDateMode
    start: date | None = None
    end: date | None = None

    @model_validator(mode="after")
    def validate_range(self) -> "SmartListDateFilter":
        if self.mode == "range":
            if self.start is None or self.end is None:
                raise ValueError("自定义日期范围必须提供开始和结束日期")
            if self.end < self.start:
                raise ValueError("结束日期不得早于开始日期")
        return self


class SmartListFilters(BaseModel):
    statuses: list[SmartListStatus] = Field(default_factory=lambda: ["active"])
    priorities: list[Literal[0, 1, 3, 5]] = Field(default_factory=list)
    tag_ids: list[UUID] = Field(default_factory=list)
    date: SmartListDateFilter | None = None

    @field_validator("statuses")
    @classmethod
    def validate_statuses(cls, value: list[SmartListStatus]) -> list[SmartListStatus]:
        result = list(dict.fromkeys(value))
        if not result:
            raise ValueError("至少选择一个任务状态")
        return result

    @field_validator("priorities", "tag_ids")
    @classmethod
    def unique_values(cls, value: list):
        return list(dict.fromkeys(value))


class SmartListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#6C5CE7", pattern=HEX_COLOR)
    source_list_ids: list[UUID] = Field(min_length=1)
    filters: SmartListFilters = Field(default_factory=SmartListFilters)

    @field_validator("name")
    @classmethod
    def clean_smart_list_name(cls, value: str) -> str:
        if not (cleaned := value.strip()):
            raise ValueError("智能清单名称不能为空")
        return cleaned

    @field_validator("source_list_ids")
    @classmethod
    def unique_sources(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class SmartListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    sort_order: int | None = None
    source_list_ids: list[UUID] | None = Field(default=None, min_length=1)
    filters: SmartListFilters | None = None

    @field_validator("name")
    @classmethod
    def clean_smart_list_update_name(cls, value: str | None) -> str | None:
        if value is not None and not (value := value.strip()):
            raise ValueError("智能清单名称不能为空")
        return value

    @field_validator("source_list_ids")
    @classmethod
    def unique_update_sources(cls, value: list[UUID] | None) -> list[UUID] | None:
        return list(dict.fromkeys(value)) if value is not None else None


class SmartListResponse(ApiModel):
    id: UUID
    name: str
    color: str
    sort_order: int
    source_list_ids: list[UUID]
    filters: SmartListFilters
    task_count: int = 0
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
    recurrence_type: Literal["daily", "weekdays", "weekly", "monthly"] | None = None
    recurrence_start_date: date | None = None
    recurrence_end_date: date | None = None
    recurrence_weekday: int | None = Field(default=None, ge=0, le=6)
    recurrence_monthday: int | None = Field(default=None, ge=1, le=31)
    reminder_offset_minutes: int | None = Field(default=None, ge=0)

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
        if (
            self.recurrence_end_date
            and self.recurrence_start_date
            and self.recurrence_end_date < self.recurrence_start_date
        ):
            raise ValueError("循环结束日期不得早于开始日期")
        if self.recurrence_type and not self.recurrence_start_date:
            raise ValueError("循环任务必须设置开始日期")
        if self.recurrence_type == "weekly" and self.recurrence_weekday is None:
            raise ValueError("每周循环必须指定星期")
        if self.recurrence_type == "monthly" and self.recurrence_monthday is None:
            raise ValueError("每月循环必须指定日期")
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
    recurrence_type: str | None = None
    recurrence_start_date: date | None = None
    recurrence_end_date: date | None = None
    recurrence_weekday: int | None = None
    recurrence_monthday: int | None = None
    reminder_offset_minutes: int | None = None
    source_task_id: UUID | None = None
    occurrence_date: date | None = None
    is_recurring_occurrence: bool = False


class TaskPage(BaseModel):
    items: list[TaskResponse]
    next_cursor: str | None


TaskView = Literal["inbox", "today", "all", "completed", "trash"]
TaskDateSection = Literal["today", "overdue"]
TaskSort = Literal["manual", "created_asc", "created_desc", "due_asc", "priority_desc"]


AgentRunStatus = Literal[
    "running",
    "waiting_user",
    "succeeded",
    "failed",
    "cancelled",
    "dismissed",
]
AgentRunLane = Literal["attention", "active", "history"]
AgentRunOutcome = Literal["succeeded", "failed", "cancelled"]


def _strip_text(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class AgentRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    title: str = Field(max_length=160)
    summary: str | None = Field(default=None, max_length=2000)
    session_ref: str | None = Field(default=None, max_length=300)
    session_url: str | None = Field(default=None, max_length=1000)
    workspace_label: str | None = Field(default=None, max_length=300)
    task_id: UUID | None = None

    @field_validator(
        "title", "summary", "session_ref", "session_url", "workspace_label", mode="before"
    )
    @classmethod
    def strip_fields(cls, value: object) -> object:
        return _strip_text(value)

    @field_validator("title")
    @classmethod
    def require_title(cls, value: str) -> str:
        if not value:
            raise ValueError("标题不能为空")
        return value

    @field_validator("session_ref", "session_url", "workspace_label")
    @classmethod
    def empty_optional_text_to_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("session_url")
    @classmethod
    def validate_session_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("会话链接必须是带主机名的 HTTPS 地址")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("会话链接不能包含账号密码")
        return value


class AgentRunEventBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(gt=0)


class AgentProgressEvent(AgentRunEventBase):
    type: Literal["progress"]
    summary: str = Field(max_length=2000)

    @field_validator("summary", mode="before")
    @classmethod
    def strip_summary(cls, value: object) -> object:
        return _strip_text(value)

    @field_validator("summary")
    @classmethod
    def require_summary(cls, value: str) -> str:
        if not value:
            raise ValueError("进展摘要不能为空")
        return value


class AgentWaitEvent(AgentRunEventBase):
    type: Literal["wait"]
    reason: str = Field(max_length=2000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value: object) -> object:
        return _strip_text(value)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value: str) -> str:
        if not value:
            raise ValueError("待处理原因不能为空")
        return value


class AgentResumeEvent(AgentRunEventBase):
    type: Literal["resume"]
    summary: str = Field(max_length=2000)

    @field_validator("summary", mode="before")
    @classmethod
    def strip_summary(cls, value: object) -> object:
        return _strip_text(value)

    @field_validator("summary")
    @classmethod
    def require_summary(cls, value: str) -> str:
        if not value:
            raise ValueError("恢复摘要不能为空")
        return value


class AgentFinishEvent(AgentRunEventBase):
    type: Literal["finish"]
    outcome: AgentRunOutcome
    summary: str = Field(max_length=2000)

    @field_validator("summary", mode="before")
    @classmethod
    def strip_summary(cls, value: object) -> object:
        return _strip_text(value)

    @field_validator("summary")
    @classmethod
    def require_summary(cls, value: str) -> str:
        if not value:
            raise ValueError("结果摘要不能为空")
        return value


class AgentDismissEvent(AgentRunEventBase):
    type: Literal["dismiss"]


AgentRunEvent = Annotated[
    AgentProgressEvent | AgentWaitEvent | AgentResumeEvent | AgentFinishEvent | AgentDismissEvent,
    Field(discriminator="type"),
]


class AgentRunWriteResponse(BaseModel):
    run_id: UUID
    version: int


class AgentRunResponse(BaseModel):
    id: UUID
    source: str
    title: str
    summary: str
    status: AgentRunStatus
    version: int
    session_ref: str | None
    session_url: str | None
    workspace_label: str | None
    task_id: UUID | None
    created_at: datetime
    updated_at: datetime
    status_changed_at: datetime

    @field_validator("created_at", "updated_at", "status_changed_at")
    @classmethod
    def normalize_utc(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class AgentRunPage(BaseModel):
    items: list[AgentRunResponse]
    next_cursor: str | None
