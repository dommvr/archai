"""
backend/app/copilot/tools.py

Copilot tool registry — structured tool definitions + execution handlers.

Tool philosophy:
  - Each tool returns real data if the source exists, or a structured
    `not_ready` response if the upstream feature is not yet implemented.
  - Tools NEVER fabricate data. A not_ready result is always preferable
    to a hallucinated one.
  - Column and table names are taken from the actual Supabase migrations —
    never guessed.  Repository methods normalise raw DB rows into stable
    tool-friendly shapes so handler code never accesses raw column names.

V1 tools:
  ✅ get_project_summary     — project metadata (always available)
  ✅ get_run_history          — recent precheck runs (always available)
  ✅ get_metrics              — model geometry snapshot metrics (viewer model → active model → run fallback)
  ✅ get_issues               — compliance issues (needs active run with evaluation results)
  ✅ get_checklist            — permit checklist items (queries permit_checklist_items; not_ready if empty)
  ✅ get_rules                — extracted zoning rules (schema-safe: title/rule_code/value_number/units)
  ✅ get_viewer_selection     — selected objects in Speckle viewer (wired to mounted viewer)
  ✅ search_project_docs      — retrieval over uploaded docs (pgvector TODO but safe stub)
  ✅ list_documents           — list uploaded docs with real filenames/timestamps
  ✅ get_active_model_summary — active model ref + snapshot summary

Legend:
  ✅ = functional now (may return not_ready if underlying data is absent)
  ⚠️  = partially ready — noted in handler docstring
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from app.copilot.repositories import CopilotRepository

log = logging.getLogger(__name__)

# ── Tool schemas ───────────────────────────────────────────────
#
# COPILOT_TOOLS_RESPONSES: Responses API format (flat — used by service.py)
#   {"type":"function","name":...,"description":...,"parameters":...}
#
# The Responses API (used by GPT-5.4) requires the flat format.

COPILOT_TOOLS_RESPONSES: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_project_summary",
        "description": (
            "Returns key metadata about the current project: name, creation date, "
            "number of uploaded documents, and recent run history."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "get_run_history",
        "description": (
            "Returns the 5 most recent precheck runs for this project, including "
            "their status and readiness score."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "get_metrics",
        "description": (
            "Returns model metrics from the geometry snapshot: gross floor area (GFA), "
            "building height, FAR, floor breakdown, and any other derived metrics. "
            "Uses the model currently shown in the Speckle viewer, or the project's "
            "default active model if no viewer model is specified. "
            "Does NOT require a completed precheck run — metrics are derived at model sync time."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "model_ref_id": {
                    "type": "string",
                    "description": (
                        "UUID of the speckle_model_ref to get metrics for. "
                        "If omitted, uses the viewer's active model or the project default."
                    ),
                }
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_issues",
        "description": (
            "Returns the compliance issues found in a precheck run, including severity, "
            "title, summary, metric key, and measured vs. allowed values. "
            "Requires a completed or evaluated run."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "UUID of the run to get issues for.",
                }
            },
            "required": ["run_id"],
        },
    },
    {
        "type": "function",
        "name": "get_checklist",
        "description": (
            "Returns the permit checklist items for a precheck run, showing which "
            "permit conditions are resolved or pending, grouped by category."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "run_id": {
                    "type": "string",
                    "description": "UUID of the run to get the checklist for.",
                }
            },
            "required": ["run_id"],
        },
    },
    {
        "type": "function",
        "name": "get_rules",
        "description": (
            "Returns the approved zoning rules extracted for this project: "
            "height limits, setbacks, FAR, lot coverage, parking requirements. "
            "Each rule includes its rule code, title, metric key, numeric threshold, "
            "units, and operator."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "get_viewer_selection",
        "description": (
            "Returns the Speckle objects currently selected in the 3D viewer, "
            "including their IDs and any properties forwarded from the viewer. "
            "Returns an empty selection if nothing is selected."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "search_project_docs",
        "description": (
            "Searches the project's uploaded documents for relevant content. "
            "Use this for questions about zoning codes, specifications, or site reports."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query.",
                }
            },
            "required": ["query"],
        },
    },
    {
        "type": "function",
        "name": "list_documents",
        "description": (
            "Returns the list of documents uploaded to this project, "
            "including file names, document types, and upload timestamps."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "get_active_model_summary",
        "description": (
            "Returns a summary of the project's active Speckle model: "
            "model name, stream ID, version, and when it was last synced. "
            "Falls back to the model currently shown in the viewer if set."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
]


# ── Tool executor ─────────────────────────────────────────────

class CopilotToolExecutor:
    def __init__(
        self,
        repo: CopilotRepository,
        project_id: UUID,
        ui_context_run_id: UUID | None = None,
        viewer_selection: list[dict[str, Any]] | None = None,
        active_model_ref_id: UUID | None = None,
    ) -> None:
        self._repo = repo
        self._project_id = project_id
        self._ui_run_id = ui_context_run_id
        # Viewer selection forwarded from SpeckleViewer via ui_context.selected_object_ids.
        # Empty list means nothing is selected (viewer may still be mounted and running).
        self._viewer_selection = viewer_selection or []
        # speckle_model_refs.id of the model currently loaded in the viewer.
        # Forwarded from ui_context.active_model_ref_id.
        self._active_model_ref_id = active_model_ref_id

    async def execute(self, tool_name: str, args: dict[str, Any]) -> Any:
        """Dispatch a tool call by name and return a JSON-serialisable result."""
        handler = {
            "get_project_summary":    self._get_project_summary,
            "get_run_history":        self._get_run_history,
            "get_metrics":            self._get_metrics,
            "get_issues":             self._get_issues,
            "get_checklist":          self._get_checklist,
            "get_rules":              self._get_rules,
            "get_viewer_selection":   self._get_viewer_selection,
            "search_project_docs":    self._search_project_docs,
            "list_documents":         self._list_documents,
            "get_active_model_summary": self._get_active_model_summary,
        }.get(tool_name)

        if handler is None:
            log.warning("Unknown tool called: %s", tool_name)
            return {"status": "error", "reason": f"Unknown tool: {tool_name}"}

        try:
            result = await handler(args)
            log.debug(
                "Tool %s → status=%s",
                tool_name,
                result.get("status") if isinstance(result, dict) else "ok",
            )
            return result
        except Exception as exc:  # noqa: BLE001
            log.exception("Tool %s failed: %s", tool_name, exc)
            return {"status": "error", "reason": str(exc)}

    # ── Individual tool handlers ──────────────────────────────

    async def _get_project_summary(self, _args: dict[str, Any]) -> dict[str, Any]:
        meta = await self._repo.get_project_metadata(self._project_id)
        if not meta:
            return {"status": "not_ready", "reason": "Project not found"}

        docs = await self._repo.get_uploaded_documents(self._project_id, limit=5)
        runs = await self._repo.get_recent_runs(self._project_id, limit=3)

        return {
            "status": "ok",
            "project": {
                "id":         meta["id"],
                "name":       meta["name"],
                "created_at": meta["created_at"],
                "updated_at": meta["updated_at"],
            },
            "document_count": len(docs),
            "recent_runs": [
                {"id": r["id"], "name": r.get("name"), "status": r["status"]}
                for r in runs
            ],
        }

    async def _get_run_history(self, _args: dict[str, Any]) -> dict[str, Any]:
        runs = await self._repo.get_recent_runs(self._project_id, limit=5)
        if not runs:
            return {
                "status": "ok",
                "runs": [],
                "note": "No precheck runs found for this project.",
            }
        return {
            "status": "ok",
            "runs": [
                {
                    "id":              r["id"],
                    "name":            r.get("name"),
                    "status":          r["status"],
                    "readiness_score": r.get("readiness_score"),
                    "created_at":      r["created_at"],
                }
                for r in runs
            ],
        }

    async def _get_metrics(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns model metrics from geometry_snapshots.

        Priority order for resolving which model to use:
          1. model_ref_id explicitly passed in tool args
          2. active_model_ref_id from ui_context (viewer's currently loaded model)
          3. project's default active_model_ref from the projects table
          4. Fall back to precheck run readiness score if nothing else is available

        Geometry snapshots are created at model sync time — metrics are available
        as soon as the model is synced, before any precheck run completes.

        Schema source: migration 20240301000001 + 20240301000011
          geometry_snapshots: metrics (JSONB array of {key, value, units, sourceObjectIds, computationNotes})
        """
        from uuid import UUID as _UUID

        # ── Resolve model ref id ──────────────────────────────────
        model_ref_id: UUID | None = None

        # 1. Explicit arg from tool call
        arg_model_ref_id = args.get("model_ref_id")
        if arg_model_ref_id:
            try:
                model_ref_id = _UUID(arg_model_ref_id)
            except ValueError:
                log.warning("get_metrics: invalid model_ref_id arg: %s", arg_model_ref_id)

        # 2. Viewer context
        if model_ref_id is None and self._active_model_ref_id:
            model_ref_id = self._active_model_ref_id
            log.debug("get_metrics: using viewer model_ref_id=%s", model_ref_id)

        # 3. Project default active model
        if model_ref_id is None:
            active_ref = await self._repo.get_active_model_ref_for_project(
                self._project_id
            )
            if active_ref:
                try:
                    model_ref_id = _UUID(active_ref["id"])
                    log.debug("get_metrics: using project default model_ref_id=%s", model_ref_id)
                except (KeyError, ValueError):
                    pass

        # ── Query geometry snapshot ───────────────────────────────
        if model_ref_id is not None:
            snapshot = await self._repo.get_geometry_snapshot_for_model_ref(
                model_ref_id
            )
            if snapshot:
                metrics_list = snapshot.get("metrics") or []
                # Normalise metric entries — DB stores them as JSONB dicts
                # Keys per migration: key, value, units, sourceObjectIds, computationNotes
                metrics_formatted = [
                    {
                        "key":   m.get("key"),
                        "value": m.get("value"),
                        "units": m.get("units"),
                        "notes": m.get("computationNotes") or m.get("computation_notes"),
                    }
                    for m in metrics_list
                    if isinstance(m, dict) and m.get("key")
                ]
                log.debug(
                    "get_metrics: found snapshot=%s metric_count=%d",
                    snapshot.get("id"), len(metrics_formatted),
                )
                return {
                    "status":        "ok",
                    "model_ref_id":  str(model_ref_id),
                    "snapshot_id":   snapshot.get("id"),
                    "snapshot_date": snapshot.get("created_at"),
                    "metric_count":  len(metrics_formatted),
                    "metrics":       metrics_formatted,
                    "source":        "geometry_snapshot",
                }

            # Model ref exists but no snapshot yet (model not yet synced)
            log.debug("get_metrics: no snapshot for model_ref_id=%s", model_ref_id)
            return {
                "status":       "not_ready",
                "model_ref_id": str(model_ref_id),
                "reason": (
                    "Model is registered but has not been synced yet — "
                    "geometry snapshot is not available. "
                    "Sync the model in the Models page to generate metrics."
                ),
            }

        # ── Last resort: run readiness score ──────────────────────
        # No model ref resolved — try precheck run as a minimal fallback
        run_id_str: str | None = str(self._ui_run_id) if self._ui_run_id else None
        if run_id_str:
            run = await self._repo.get_run_summary(_UUID(run_id_str))
            if run and run.get("readiness_score") is not None:
                return {
                    "status":          "partial",
                    "run_id":          run["id"],
                    "run_name":        run.get("name"),
                    "readiness_score": run["readiness_score"],
                    "run_status":      run["status"],
                    "source":          "precheck_run",
                    "note": (
                        "No geometry snapshot found for the active model. "
                        "Showing precheck run readiness score as a fallback."
                    ),
                }

        return {
            "status": "not_ready",
            "reason": (
                "No geometry snapshot found. Sync a Speckle model in the "
                "Models page to make metrics available. No precheck run is active either."
            ),
        }

    async def _get_issues(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns compliance issues for a run.

        Schema source: migration 20240301000001 compliance_issues table.
          Real columns used: title, summary, explanation, severity, status,
          metric_key, actual_value, expected_value, expected_min, expected_max,
          units, affected_object_ids
          (NOT: rule_code, message, object_ids, measured_value, allowed_value)
        """
        run_id_str: str | None = args.get("run_id")
        if not run_id_str:
            return {"status": "error", "reason": "run_id is required"}

        from uuid import UUID as _UUID
        try:
            run_id = _UUID(run_id_str)
        except ValueError:
            return {"status": "error", "reason": f"Invalid run_id: {run_id_str}"}

        issues = await self._repo.get_compliance_issues(run_id)
        if not issues:
            return {
                "status": "ok",
                "run_id": run_id_str,
                "issues": [],
                "note": (
                    "No compliance issues found for this run. Either no issues exist "
                    "or the evaluation has not run yet."
                ),
            }

        return {
            "status":      "ok",
            "run_id":      run_id_str,
            "issue_count": len(issues),
            "issues":      issues,
        }

    async def _get_checklist(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns permit checklist items from permit_checklist_items.

        Schema source: migration 20240301000001.
          Columns: category, title, description, required, resolved

        Returns not_ready if the table is empty for the run (checklist population
        is driven by the compliance engine evaluation step).
        """
        run_id_str: str | None = args.get("run_id")
        if not run_id_str:
            return {"status": "error", "reason": "run_id is required"}

        from uuid import UUID as _UUID
        try:
            run_id = _UUID(run_id_str)
        except ValueError:
            return {"status": "error", "reason": f"Invalid run_id: {run_id_str}"}

        items = await self._repo.get_checklist_items(run_id)
        if not items:
            return {
                "status": "not_ready",
                "run_id": run_id_str,
                "reason": (
                    "No checklist items found for this run. "
                    "Checklist items are generated after the compliance evaluation step completes."
                ),
            }

        resolved_count = sum(1 for i in items if i.get("resolved"))
        return {
            "status":         "ok",
            "run_id":         run_id_str,
            "item_count":     len(items),
            "resolved_count": resolved_count,
            "items":          items,
        }

    async def _get_rules(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns approved/reviewed zoning rules for the project.

        Schema source: migration 20240301000001 + 20240301000010 extracted_rules.
          Real columns: rule_code, title, description, metric_key, operator,
          value_number, value_min, value_max, units, status, source_kind,
          is_authoritative, is_recommended, confidence, extraction_notes
          (NOT: rule_text, numeric_value, unit — those names do not exist)
        """
        rules = await self._repo.get_reviewed_rules(self._project_id)
        if not rules:
            return {
                "status": "ok",
                "rules":  [],
                "note": (
                    "No approved rules found for this project. "
                    "Upload zoning documents and run rule extraction to populate this."
                ),
            }

        return {
            "status":     "ok",
            "rule_count": len(rules),
            "rules": [
                {
                    "rule_code":        r.get("rule_code"),
                    "title":            r.get("title"),
                    "description":      r.get("description"),
                    "metric_key":       r.get("metric_key"),
                    "operator":         r.get("operator"),
                    "value_number":     r.get("value_number"),
                    "value_min":        r.get("value_min"),
                    "value_max":        r.get("value_max"),
                    "units":            r.get("units"),
                    "status":           r.get("status"),
                    "source_kind":      r.get("source_kind"),
                    "is_authoritative": r.get("is_authoritative"),
                    "confidence":       r.get("confidence"),
                    "extraction_notes": r.get("extraction_notes"),
                }
                for r in rules
            ],
        }

    async def _get_viewer_selection(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns the Speckle objects currently selected in the 3D viewer.

        Selected object IDs are forwarded by the frontend via
        ui_context.selected_object_ids on every message send.
        Each entry in self._viewer_selection is {"id": <speckle_object_id>}.

        If self._viewer_selection is empty it means nothing is selected in the
        viewer right now — the viewer itself may still be mounted and working.
        """
        if not self._viewer_selection:
            return {
                "status":           "ok",
                "selected_count":   0,
                "selected_objects": [],
                "note": (
                    "Nothing is currently selected in the Speckle viewer. "
                    "Click an object in the 3D viewer and resend your message "
                    "to get its properties."
                ),
            }

        return {
            "status":           "ok",
            "selected_count":   len(self._viewer_selection),
            "selected_objects": self._viewer_selection,
        }

    async def _search_project_docs(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Semantic search over uploaded project documents.
        Delegates to the retriever (pgvector stub — safe fallback when not ready).

        Schema source: migration 20240301000001 uploaded_documents.
          file_name (not filename), uploaded_at (not created_at)
        """
        query: str = args.get("query", "")
        if not query:
            return {"status": "error", "reason": "query is required"}

        docs = await self._repo.get_uploaded_documents(self._project_id, limit=5)
        if not docs:
            return {
                "status":  "ok",
                "query":   query,
                "results": [],
                "note":    "No documents have been uploaded to this project yet.",
            }

        # pgvector retrieval not yet active — fall back to doc list only
        chunks = await self._repo.search_document_chunks(
            project_id=self._project_id,
            query_embedding=None,  # embedding not active
            top_k=5,
        )

        if not chunks:
            # file_name is the real column (not filename) — per migration 20240301000001
            doc_names = [d["file_name"] for d in docs]
            return {
                "status":          "partial",
                "query":           query,
                "results":         [],
                "document_titles": doc_names,
                "note": (
                    "Semantic search is not yet active (pgvector not configured). "
                    f"The project has {len(docs)} uploaded document(s): "
                    + ", ".join(doc_names)
                    + ". Set OPENAI_API_KEY and enable pgvector to activate search."
                ),
            }

        return {
            "status":       "ok",
            "query":        query,
            "result_count": len(chunks),
            "results":      chunks,
        }

    async def _list_documents(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns uploaded documents with filenames, types, and upload timestamps.

        Schema source: migration 20240301000001 uploaded_documents.
          Columns: file_name, document_type, mime_type, uploaded_at, jurisdiction_code
          (NOT: filename, created_at — those are wrong names for this table)
        """
        docs = await self._repo.get_uploaded_documents(self._project_id, limit=20)
        if not docs:
            return {
                "status": "ok",
                "documents": [],
                "note": "No documents have been uploaded to this project yet.",
            }

        return {
            "status":         "ok",
            "document_count": len(docs),
            "documents": [
                {
                    "id":               d["id"],
                    "file_name":        d["file_name"],
                    "document_type":    d.get("document_type"),
                    "mime_type":        d.get("mime_type"),
                    "uploaded_at":      d["uploaded_at"],
                    "jurisdiction_code": d.get("jurisdiction_code"),
                }
                for d in docs
            ],
        }

    async def _get_active_model_summary(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns the active Speckle model summary for the project.

        Resolution order:
          1. Viewer's active model (self._active_model_ref_id, if set)
          2. Project's default active model (projects.active_model_ref_id)

        Schema source: migration 20240301000001 speckle_model_refs +
          migration 20240301000008 (active_model_ref_id FK on projects) +
          migration 20240301000012 (synced_at on speckle_model_refs)
        """
        from uuid import UUID as _UUID

        model_ref_id: UUID | None = self._active_model_ref_id
        source = "viewer"

        if model_ref_id is None:
            active_ref = await self._repo.get_active_model_ref_for_project(
                self._project_id
            )
            if not active_ref:
                return {
                    "status": "not_ready",
                    "reason": (
                        "No active model set for this project. "
                        "Go to the Models page and set a model as active."
                    ),
                }
            # active_ref is the full speckle_model_refs row
            return {
                "status":       "ok",
                "source":       "project_default",
                "model_ref_id": active_ref["id"],
                "model_name":   active_ref.get("model_name"),
                "stream_id":    active_ref.get("stream_id"),
                "version_id":   active_ref.get("version_id"),
                "branch_name":  active_ref.get("branch_name"),
                "synced_at":    active_ref.get("synced_at"),
            }

        # Viewer model — fetch full ref row for it
        active_ref = await self._repo.get_active_model_ref_for_project(
            self._project_id
        )
        # If the viewer's model_ref_id matches the project default, use it
        # Otherwise just return viewer context info with available fields
        return {
            "status":       "ok",
            "source":       source,
            "model_ref_id": str(model_ref_id),
            "model_name":   active_ref.get("model_name") if active_ref and active_ref.get("id") == str(model_ref_id) else None,
            "stream_id":    active_ref.get("stream_id")  if active_ref and active_ref.get("id") == str(model_ref_id) else None,
            "synced_at":    active_ref.get("synced_at")  if active_ref and active_ref.get("id") == str(model_ref_id) else None,
        }
