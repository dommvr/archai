"""
backend/app/copilot/router.py

FastAPI router for all Copilot endpoints.

Route map:
  POST   /copilot/threads                            — create thread
  GET    /copilot/projects/{project_id}/threads      — list project threads
  GET    /copilot/threads/{thread_id}                — get thread
  PATCH  /copilot/threads/{thread_id}                — update title / archive
  DELETE /copilot/threads/{thread_id}                — archive thread

  GET    /copilot/threads/{thread_id}/messages       — list messages
  POST   /copilot/threads/{thread_id}/messages       — send message (triggers LLM)

  POST   /copilot/threads/{thread_id}/attachments/upload-url — get signed upload URL
  POST   /copilot/threads/{thread_id}/attachments    — register attachment after upload
  GET    /copilot/threads/{thread_id}/attachments    — list thread attachments

Handlers are thin: validate → call service/repo → return response.
All heavy orchestration lives in CopilotService.
"""

from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.auth import AuthenticatedUser
from app.core.dependencies import get_current_user
from app.copilot.repositories import CopilotRepository
from app.copilot.schemas import (
    CopilotAttachment,
    CopilotMessage,
    CopilotThread,
    CreateAttachmentRequest,
    CreateThreadRequest,
    SendMessageRequest,
    SendMessageResponse,
    UpdateThreadRequest,
    AttachmentUploadUrlRequest,
    AttachmentUploadUrlResponse,
    CopilotAttachmentType,
)
from app.copilot.service import CopilotService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/copilot", tags=["copilot"])

# ── Dependency helpers ────────────────────────────────────────

def _repo(request: Request) -> CopilotRepository:
    return CopilotRepository(client=request.app.state.supabase)

def _service(request: Request) -> CopilotService:
    return CopilotService(repo=_repo(request))

RepoDep    = Annotated[CopilotRepository, Depends(_repo)]
ServiceDep = Annotated[CopilotService,    Depends(_service)]
UserDep    = Annotated[AuthenticatedUser, Depends(get_current_user)]


# ════════════════════════════════════════════════════════════
# THREADS
# ════════════════════════════════════════════════════════════

@router.post(
    "/threads",
    response_model=CopilotThread,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new copilot thread",
)
async def create_thread(
    body: CreateThreadRequest,
    repo: RepoDep,
    user: UserDep,
) -> CopilotThread:
    return await repo.create_thread(
        project_id=body.project_id,
        user_id=UUID(user.user_id),
        title=body.title,
        active_run_id=body.active_run_id,
        page_context=body.page_context,
    )


@router.get(
    "/projects/{project_id}/threads",
    response_model=list[CopilotThread],
    summary="List threads for a project",
)
async def list_threads(
    project_id: UUID,
    repo: RepoDep,
    user: UserDep,
    include_archived: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> list[CopilotThread]:
    return await repo.list_threads(
        project_id=project_id,
        user_id=UUID(user.user_id),
        include_archived=include_archived,
        limit=min(limit, 50),
        offset=offset,
    )


@router.get(
    "/threads/{thread_id}",
    response_model=CopilotThread,
    summary="Get a single thread",
)
async def get_thread(
    thread_id: UUID,
    repo: RepoDep,
    user: UserDep,
) -> CopilotThread:
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@router.patch(
    "/threads/{thread_id}",
    response_model=CopilotThread,
    summary="Update thread title or archive",
)
async def update_thread(
    thread_id: UUID,
    body: UpdateThreadRequest,
    repo: RepoDep,
    user: UserDep,
) -> CopilotThread:
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    if body.title is not None:
        await repo.update_thread_title(thread_id, body.title)

    if body.archived is True:
        await repo.archive_thread(thread_id, UUID(user.user_id))

    updated = await repo.get_thread(thread_id, UUID(user.user_id))
    if updated is None:
        raise HTTPException(status_code=404, detail="Thread not found after update")
    return updated


@router.delete(
    "/threads/{thread_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive (soft-delete) a thread",
)
async def archive_thread(
    thread_id: UUID,
    repo: RepoDep,
    user: UserDep,
) -> None:
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    await repo.archive_thread(thread_id, UUID(user.user_id))


# ════════════════════════════════════════════════════════════
# MESSAGES
# ════════════════════════════════════════════════════════════

@router.get(
    "/threads/{thread_id}/messages",
    response_model=list[CopilotMessage],
    summary="List messages in a thread",
)
async def list_messages(
    thread_id: UUID,
    repo: RepoDep,
    user: UserDep,
    limit: int = 50,
    offset: int = 0,
) -> list[CopilotMessage]:
    # Verify ownership
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    return await repo.list_messages(
        thread_id=thread_id,
        limit=min(limit, 100),
        offset=offset,
    )


@router.post(
    "/threads/{thread_id}/messages",
    response_model=SendMessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send a message and get a Copilot response",
)
async def send_message(
    thread_id: UUID,
    body: SendMessageRequest,
    repo: RepoDep,
    service: ServiceDep,
    user: UserDep,
) -> SendMessageResponse:
    # Verify ownership
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Message content cannot be empty")

    return await service.send_message(
        project_id=thread.project_id,
        thread_id=thread_id,
        user_id=UUID(user.user_id),
        content=body.content,
        ui_context=body.ui_context,
        attachment_ids=body.attachment_ids,
    )


# ════════════════════════════════════════════════════════════
# ATTACHMENTS
# ════════════════════════════════════════════════════════════

@router.post(
    "/threads/{thread_id}/attachments/upload-url",
    response_model=AttachmentUploadUrlResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Get a signed upload URL for an attachment",
)
async def get_attachment_upload_url(
    thread_id: UUID,
    body: AttachmentUploadUrlRequest,
    repo: RepoDep,
    request: Request,
    user: UserDep,
) -> AttachmentUploadUrlResponse:
    """
    Creates an attachment metadata row and returns a Supabase Storage signed
    upload URL. The client uploads directly to Storage, then calls
    POST /attachments to confirm.

    TODO: The signed URL generation requires the Supabase service-role client's
    storage API. Implement once the copilot-attachments bucket is created in
    Supabase Storage.
    """
    # Verify thread ownership
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    import uuid as _uuid
    attachment_id = _uuid.uuid4()
    storage_path = (
        f"copilot/{body.project_id}/{thread_id}/{attachment_id}/{body.filename}"
    )

    # Create the metadata row
    att = await repo.create_attachment(
        thread_id=thread_id,
        project_id=body.project_id,
        user_id=UUID(user.user_id),
        attachment_type=body.attachment_type,
        filename=body.filename,
        storage_path=storage_path,
        mime_type=body.mime_type,
        file_size_bytes=body.file_size_bytes,
    )

    # TODO: Generate real Supabase Storage signed URL once bucket exists.
    # signed = await request.app.state.supabase.storage
    #     .from_("copilot-attachments")
    #     .create_signed_upload_url(storage_path)
    # upload_url = signed["signedURL"]
    upload_url = f"__TODO_STORAGE_SIGNED_URL__{storage_path}"

    return AttachmentUploadUrlResponse(
        upload_url=upload_url,
        storage_path=storage_path,
        attachment_id=att.id,
    )


@router.post(
    "/threads/{thread_id}/attachments",
    response_model=CopilotAttachment,
    status_code=status.HTTP_201_CREATED,
    summary="Register an attachment after upload",
)
async def create_attachment(
    thread_id: UUID,
    body: CreateAttachmentRequest,
    repo: RepoDep,
    user: UserDep,
) -> CopilotAttachment:
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    return await repo.create_attachment(
        thread_id=thread_id,
        project_id=body.project_id,
        user_id=UUID(user.user_id),
        attachment_type=body.attachment_type,
        filename=body.filename,
        storage_path=body.storage_path,
        mime_type=body.mime_type,
        file_size_bytes=body.file_size_bytes,
        context_metadata=body.context_metadata,
    )


@router.get(
    "/threads/{thread_id}/attachments",
    response_model=list[CopilotAttachment],
    summary="List attachments for a thread",
)
async def list_attachments(
    thread_id: UUID,
    repo: RepoDep,
    user: UserDep,
) -> list[CopilotAttachment]:
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    return await repo.get_attachments_for_thread(thread_id)
