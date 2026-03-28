"""
backend/app/copilot/schemas.py

Pydantic v2 request/response schemas for the Copilot API.

All domain schemas inherit BaseSchema (camelCase aliases via alias_generator)
so the JSON contract matches the TypeScript types in types/index.ts exactly.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


# ── Base config ───────────────────────────────────────────────

class BaseSchema(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Enums ─────────────────────────────────────────────────────

class CopilotMessageRole(str, Enum):
    USER      = "user"
    ASSISTANT = "assistant"
    TOOL      = "tool"
    SYSTEM    = "system"


class CopilotAttachmentType(str, Enum):
    IMAGE      = "image"
    DOCUMENT   = "document"
    SCREENSHOT = "screenshot"


# ── UI context (sent from frontend on every turn) ─────────────

class CopilotUiContext(BaseSchema):
    """Snapshot of what the user was looking at when they sent the message."""
    current_page: str | None = None
    active_run_id: UUID | None = None
    selected_object_ids: list[str] = Field(default_factory=list)
    selected_issue_id: UUID | None = None
    # speckle_model_refs.id currently loaded in the viewer (None = not mounted)
    active_model_ref_id: UUID | None = None


# ── Thread ────────────────────────────────────────────────────

class CopilotThread(BaseSchema):
    id: UUID
    project_id: UUID
    user_id: UUID
    title: str | None = None
    active_run_id: UUID | None = None
    page_context: str | None = None
    archived: bool = False
    created_at: datetime
    updated_at: datetime
    # Injected at query time — last message preview for the thread list
    last_message_preview: str | None = None


class CreateThreadRequest(BaseSchema):
    project_id: UUID
    title: str | None = None
    active_run_id: UUID | None = None
    page_context: str | None = None


class UpdateThreadRequest(BaseSchema):
    title: str | None = None
    archived: bool | None = None


# ── Message ───────────────────────────────────────────────────

class CopilotMessage(BaseSchema):
    id: UUID
    thread_id: UUID
    project_id: UUID
    role: CopilotMessageRole
    content: str
    tool_name: str | None = None
    tool_call_id: str | None = None
    tool_payload: dict[str, Any] | None = None
    ui_context: CopilotUiContext | None = None
    created_at: datetime


class SendMessageRequest(BaseSchema):
    """Payload from the Next.js proxy when the user submits a message."""
    content: str
    ui_context: CopilotUiContext | None = None
    attachment_ids: list[UUID] = Field(default_factory=list)


class SendMessageResponse(BaseSchema):
    user_message: CopilotMessage
    assistant_message: CopilotMessage
    # Tool messages produced during this turn, in execution order.
    # Included so the frontend can display them live without a round-trip reload.
    tool_messages: list[CopilotMessage] = []


# ── Attachment ────────────────────────────────────────────────

class CopilotAttachment(BaseSchema):
    id: UUID
    thread_id: UUID
    message_id: UUID | None = None
    project_id: UUID
    user_id: UUID
    attachment_type: CopilotAttachmentType
    filename: str
    mime_type: str | None = None
    storage_path: str
    file_size_bytes: int | None = None
    context_metadata: dict[str, Any] | None = None
    created_at: datetime


class CreateAttachmentRequest(BaseSchema):
    thread_id: UUID
    project_id: UUID
    attachment_type: CopilotAttachmentType
    filename: str
    mime_type: str | None = None
    storage_path: str
    file_size_bytes: int | None = None
    context_metadata: dict[str, Any] | None = None


class AttachmentUploadUrlRequest(BaseSchema):
    thread_id: UUID
    project_id: UUID
    filename: str
    mime_type: str
    attachment_type: CopilotAttachmentType
    file_size_bytes: int | None = None


class AttachmentUploadUrlResponse(BaseSchema):
    upload_url: str
    storage_path: str
    attachment_id: UUID
