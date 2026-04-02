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
    CreateNoteRequest,
    CreateThreadRequest,
    ProjectNote,
    SendMessageRequest,
    SendMessageResponse,
    UpdateNoteRequest,
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

    capped = min(limit, 200)
    log.debug(
        "list_messages: thread=%s limit=%d offset=%d",
        thread_id, capped, offset,
    )
    return await repo.list_messages(
        thread_id=thread_id,
        limit=capped,
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
    upload URL. The client uploads the file bytes directly to Storage using
    the signed URL (PUT with Content-Type header), then the attachment row
    is considered live and will be included in subsequent LLM turns.

    Signed upload URLs bypass bucket RLS — no bucket policies are needed
    for the upload path. The service-role key is used server-side to
    generate the URL; the browser never sees the service-role key.

    Requires:
      - "copilot-attachments" bucket to exist in Supabase Storage
        (Dashboard → Storage → New bucket, name: copilot-attachments)
      - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in backend .env

    Returns HTTP 503 if the bucket is not yet created (storage API error),
    with a clear message so the developer can action it.
    """
    import uuid as _uuid

    # Verify thread ownership
    thread = await repo.get_thread(thread_id, UUID(user.user_id))
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    attachment_id = _uuid.uuid4()
    # Storage path: copilot/<project_id>/<thread_id>/<attachment_id>/<filename>
    # Scoped so per-project cleanup is trivial.
    storage_path = (
        f"copilot/{body.project_id}/{thread_id}/{attachment_id}/{body.filename}"
    )

    # Create the metadata row before generating the URL so we always have
    # a record even if the URL generation fails (for debugging).
    att = await repo.create_attachment(
        thread_id=thread_id,
        project_id=body.project_id,
        user_id=UUID(user.user_id),
        attachment_type=body.attachment_type,
        filename=body.filename,
        storage_path=storage_path,
        mime_type=body.mime_type,
        file_size_bytes=body.file_size_bytes,
        context_metadata={"upload_status": "pending"},
    )

    # Generate a Supabase Storage signed upload URL via the service-role client.
    # The signed URL is time-limited (default 60 s) and authorises a single PUT.
    # The browser uploads directly to Storage; the service-role key is never
    # exposed to the client.
    try:
        signed = await request.app.state.supabase.storage.from_(
            "copilot-attachments"
        ).create_signed_upload_url(storage_path)
        # storage3 returns {"signed_url": "...", "signedUrl": "...", "token": "...", "path": "..."}
        # Use .get() with both key variants so we are robust against any
        # future storage3 rename; signed_url (snake_case) is the canonical key.
        upload_url: str = signed.get("signed_url") or signed.get("signedUrl") or ""
        if not upload_url:
            raise KeyError(f"No upload URL in storage response: {list(signed.keys())}")
    except Exception as exc:
        log.error(
            "get_attachment_upload_url: Storage signed URL generation failed "
            "(bucket 'copilot-attachments' may not exist): %s", exc,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Attachment storage is not configured. "
                "Create the 'copilot-attachments' bucket in Supabase Storage "
                "and ensure SUPABASE_SERVICE_ROLE_KEY is set."
            ),
        )

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


# ════════════════════════════════════════════════════════════
# PROJECT NOTES
# ════════════════════════════════════════════════════════════

def _note_to_schema(note: dict) -> ProjectNote:
    return ProjectNote.model_validate(note)


@router.get(
    "/projects/{project_id}/notes",
    response_model=list[ProjectNote],
    summary="List notes for a project",
)
async def list_notes(
    project_id: UUID,
    repo: RepoDep,
    user: UserDep,
    limit: int = 50,
) -> list[ProjectNote]:
    notes = await repo.list_project_notes(
        project_id=project_id,
        user_id=UUID(user.user_id),
        limit=min(limit, 100),
    )
    return [_note_to_schema(n) for n in notes]


@router.post(
    "/projects/{project_id}/notes",
    response_model=ProjectNote,
    status_code=status.HTTP_201_CREATED,
    summary="Create a project note",
)
async def create_note(
    project_id: UUID,
    body: CreateNoteRequest,
    repo: RepoDep,
    user: UserDep,
) -> ProjectNote:
    note = await repo.create_note(
        project_id=project_id,
        user_id=UUID(user.user_id),
        title=body.title,
        content=body.content,
        pinned=body.pinned,
        source_type=body.source_type.value,
        source_message_id=body.source_message_id,
    )
    return _note_to_schema(note)


@router.get(
    "/notes/{note_id}",
    response_model=ProjectNote,
    summary="Get a single project note",
)
async def get_note(
    note_id: UUID,
    repo: RepoDep,
    user: UserDep,
) -> ProjectNote:
    # Fetch via update with no changes to get the row (and verify ownership)
    note = await repo.update_note(note_id, UUID(user.user_id))
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return _note_to_schema(note)


@router.patch(
    "/notes/{note_id}",
    response_model=ProjectNote,
    summary="Update a project note",
)
async def update_note(
    note_id: UUID,
    body: UpdateNoteRequest,
    repo: RepoDep,
    user: UserDep,
) -> ProjectNote:
    note = await repo.update_note(
        note_id=note_id,
        user_id=UUID(user.user_id),
        title=body.title,
        content=body.content,
        pinned=body.pinned,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return _note_to_schema(note)


@router.delete(
    "/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project note",
)
async def delete_note(
    note_id: UUID,
    repo: RepoDep,
    user: UserDep,
) -> None:
    deleted = await repo.delete_note(note_id, UUID(user.user_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
