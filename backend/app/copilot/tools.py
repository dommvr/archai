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
  ✅ get_project_summary      — project metadata (always available)
  ✅ get_run_history           — recent precheck runs (always available)
  ✅ get_metrics               — geometry snapshot metrics with source_object_ids
  ✅ get_issues                — compliance issues (needs evaluated run)
  ✅ get_checklist             — permit checklist items (not_ready if empty)
  ✅ get_extracted_rules       — ALL extracted rules with status/metric/doc filters
  ✅ get_rules_summary         — rule counts grouped by status
  ✅ get_viewer_selection      — selected objects in Speckle viewer
  ✅ search_project_docs       — retrieval over uploaded docs (pgvector stub)
  ✅ list_documents            — list uploaded docs with filenames/timestamps
  ✅ get_active_model_summary  — active model ref + snapshot summary
  ✅ list_project_models       — all speckle_model_refs for the project

Legend:
  ✅ = functional now (may return not_ready if underlying data is absent)
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

# NOTE: user_id is not available in the executor because tools only query
# project-scoped data. Notes queries include user_id for RLS-safe access via
# the service-role client — executor receives it from the service layer.

from app.copilot.repositories import CopilotRepository
from app.copilot.retriever import CopilotRetriever

log = logging.getLogger(__name__)

# ── Tool schemas ───────────────────────────────────────────────
#
# COPILOT_TOOLS_RESPONSES: Responses API format (flat — used by service.py)
# The Responses API (used by GPT-5.4) requires this flat format.

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
            "Each metric includes source_object_ids — the Speckle object IDs whose "
            "geometry contributes to that metric value. "
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
            "title, summary, metric key, measured vs. allowed values, and affected object IDs. "
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
        "name": "get_extracted_rules",
        "description": (
            "Returns extracted zoning rules for this project. "
            "By default returns ALL rules regardless of status (draft, reviewed, approved, "
            "auto_approved, rejected, superseded). "
            "Use status_filter to narrow to a specific lifecycle stage. "
            "Use metric_key to filter by topic (e.g. 'building_height_m', 'parking_spaces_required'). "
            "Each rule includes: rule code, title, description, metric key, operator, "
            "numeric threshold, units, status, confidence, and conflict group ID if present."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "status_filter": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional list of statuses to include. "
                        "Valid values: draft, reviewed, approved, auto_approved, rejected, superseded. "
                        "Omit to return all statuses."
                    ),
                },
                "metric_key": {
                    "type": "string",
                    "description": (
                        "Optional: filter rules by metric key. "
                        "Examples: building_height_m, far, lot_coverage_pct, "
                        "parking_spaces_required, front_setback_m, rear_setback_m, "
                        "side_setback_left_m, side_setback_right_m, gross_floor_area_m2."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of rules to return (default 50, max 100).",
                },
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "get_rules_summary",
        "description": (
            "Returns a count of extracted rules grouped by status for this project. "
            "Useful for answering: 'How many rules are waiting for review?', "
            "'How many rules have been approved?', 'Are there any conflicting rules?'. "
            "Returns total count + breakdown by status."
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
            "Searches the project's uploaded documents using semantic similarity. "
            "Returns the most relevant text passages from uploaded zoning codes, "
            "building codes, project documents, and specifications. "
            "Use this when the user asks about specific rules, requirements, or "
            "content from documents (e.g. 'What does the zoning code say about FAR?', "
            "'Are there parking exceptions?', 'What is the height limit in Section 4?'). "
            "Each result includes the source document name, section, page, and "
            "relevance score. Results are grounded in actual document text."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The search query — phrase it as you would search "
                        "for a rule or requirement in a zoning document."
                    ),
                },
                "top_k": {
                    "type": "integer",
                    "description": (
                        "Maximum number of document passages to return "
                        "(default 5, max 10)."
                    ),
                },
                "similarity_threshold": {
                    "type": "number",
                    "description": (
                        "Minimum similarity score 0–1 for a passage to be "
                        "included (default 0.50). Lower = more results but "
                        "less relevant. Raise to 0.70+ for tighter matches."
                    ),
                },
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
    {
        "type": "function",
        "name": "list_project_models",
        "description": (
            "Returns all Speckle model references registered for this project, "
            "not just the active one. Each entry includes model name, stream ID, "
            "version, branch, and sync timestamp. "
            "Use this to answer: 'What models are in this project?', "
            "'Do we have a model named X?', 'Which model is active and what others exist?'"
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "list_project_notes",
        "description": (
            "Returns the user's saved project notes — both manually written and "
            "notes previously saved from Copilot answers. "
            "Pinned notes appear first. "
            "Use this to answer: 'What notes do I have?', "
            "'Did I note anything about setbacks?', 'Show me my pinned notes'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of notes to return (default 20, max 50).",
                }
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "search_project_notes",
        "description": (
            "Searches the user's project notes by keyword. "
            "Returns notes whose title or content matches the query. "
            "Use this when the user references something they may have noted before."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Keyword or phrase to search for in note titles and content.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (default 10).",
                },
            },
            "required": ["query"],
        },
    },
    {
        "type": "function",
        "name": "get_pinned_notes",
        "description": (
            "Returns only the user's pinned project notes. "
            "Pinned notes are typically the most important or frequently referenced. "
            "Use this to quickly surface key decisions or constraints the user has flagged."
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
        retriever: CopilotRetriever | None = None,
        user_id: UUID | None = None,
        ui_context_run_id: UUID | None = None,
        viewer_selection: list[dict[str, Any]] | None = None,
        active_model_ref_id: UUID | None = None,
    ) -> None:
        self._repo = repo
        # Retriever is injected from the service so embedding clients are
        # shared rather than re-initialised per tool call.
        self._retriever = retriever
        self._project_id = project_id
        # user_id is required for notes queries (RLS-scoped) but optional for
        # project-wide tools. Service layer always passes it.
        self._user_id = user_id
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
            "get_extracted_rules":    self._get_extracted_rules,
            "get_rules_summary":      self._get_rules_summary,
            # Legacy alias kept for backward compat with any stored tool calls
            "get_rules":              self._get_extracted_rules,
            "get_viewer_selection":   self._get_viewer_selection,
            "search_project_docs":    self._search_project_docs,
            "list_documents":         self._list_documents,
            "get_active_model_summary": self._get_active_model_summary,
            "list_project_models":    self._list_project_models,
            "list_project_notes":     self._list_project_notes,
            "search_project_notes":   self._search_project_notes,
            "get_pinned_notes":       self._get_pinned_notes,
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
        Returns model metrics from geometry_snapshots, including source_object_ids.

        Priority order for resolving which model to use:
          1. model_ref_id explicitly passed in tool args
          2. active_model_ref_id from ui_context (viewer's currently loaded model)
          3. project's default active_model_ref from the projects table
          4. Fall back to precheck run readiness score if nothing else is available

        Schema source: migration 20240301000001 geometry_snapshots.metrics JSONB:
          [{key, value, units, sourceObjectIds, computationNotes}]

        sourceObjectIds (camelCase in JSONB) are the Speckle object IDs contributing
        to this metric. They are always included in the response when present.
        """
        from uuid import UUID as _UUID

        # ── Resolve model ref id ──────────────────────────────────
        model_ref_id: UUID | None = None

        arg_model_ref_id = args.get("model_ref_id")
        if arg_model_ref_id:
            try:
                model_ref_id = _UUID(arg_model_ref_id)
            except ValueError:
                log.warning("get_metrics: invalid model_ref_id arg: %s", arg_model_ref_id)

        if model_ref_id is None and self._active_model_ref_id:
            model_ref_id = self._active_model_ref_id
            log.debug("get_metrics: using viewer model_ref_id=%s", model_ref_id)

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

        if model_ref_id is not None:
            snapshot = await self._repo.get_geometry_snapshot_for_model_ref(
                model_ref_id
            )
            if snapshot:
                metrics_list = snapshot.get("metrics") or []
                # Normalise metric entries from JSONB.
                # The JSONB keys use camelCase (sourceObjectIds, computationNotes)
                # as written by the geometry pipeline.
                metrics_formatted = []
                for m in metrics_list:
                    if not isinstance(m, dict) or not m.get("key"):
                        continue
                    # source_object_ids may be stored as sourceObjectIds (camelCase) or
                    # source_object_ids (snake_case) depending on pipeline version —
                    # check both.
                    source_ids = (
                        m.get("sourceObjectIds")
                        or m.get("source_object_ids")
                        or []
                    )
                    entry = {
                        "key":               m.get("key"),
                        "value":             m.get("value"),
                        "units":             m.get("units"),
                        "notes":             m.get("computationNotes") or m.get("computation_notes"),
                        "source_object_ids": source_ids,
                    }
                    metrics_formatted.append(entry)

                has_source_ids = any(
                    len(m.get("source_object_ids") or []) > 0
                    for m in metrics_formatted
                )
                log.debug(
                    "get_metrics: snapshot=%s metric_count=%d has_source_ids=%s",
                    snapshot.get("id"), len(metrics_formatted), has_source_ids,
                )
                return {
                    "status":          "ok",
                    "model_ref_id":    str(model_ref_id),
                    "snapshot_id":     snapshot.get("id"),
                    "snapshot_date":   snapshot.get("created_at"),
                    "metric_count":    len(metrics_formatted),
                    "metrics":         metrics_formatted,
                    "source":          "geometry_snapshot",
                    "has_source_object_ids": has_source_ids,
                    "note": (
                        "Each metric includes source_object_ids listing the Speckle "
                        "object IDs that contribute to that metric value."
                        if has_source_ids else
                        "source_object_ids not populated for this snapshot yet."
                    ),
                }

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

        # Last resort: run readiness score fallback
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
        Columns: title, summary, explanation, severity, status, metric_key,
          actual_value, expected_value, expected_min, expected_max, units,
          affected_object_ids
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
        Returns not_ready if empty (checklist driven by compliance engine pipeline).
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

    async def _get_extracted_rules(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns extracted rules for the project with optional filters.

        Unlike the old get_rules (approved-only), this returns ALL statuses by default
        so the Copilot can answer questions about draft/unreviewed rules, conflicts, etc.

        Schema source: migration 20240301000001 + 20240301000010 extracted_rules.
        Real columns: rule_code, title, description, metric_key, operator,
          value_number, value_min, value_max, units, status, source_kind,
          is_authoritative, is_recommended, confidence, extraction_notes,
          conflict_group_id
        """
        status_filter: list[str] | None = args.get("status_filter") or None
        metric_key: str | None = args.get("metric_key") or None
        limit = min(int(args.get("limit") or 50), 100)

        rules = await self._repo.get_all_extracted_rules(
            project_id=self._project_id,
            status_filter=status_filter,
            metric_key=metric_key,
            limit=limit,
        )

        if not rules:
            filter_desc = ""
            if status_filter:
                filter_desc += f" with status in {status_filter}"
            if metric_key:
                filter_desc += f" for metric '{metric_key}'"
            return {
                "status": "ok",
                "rules":  [],
                "note": (
                    f"No extracted rules found{filter_desc}. "
                    "Upload zoning documents and run rule extraction to populate this."
                ),
            }

        # Group conflict stats
        conflict_groups = set(
            r["conflict_group_id"] for r in rules
            if r.get("conflict_group_id")
        )

        return {
            "status":          "ok",
            "rule_count":      len(rules),
            "conflict_groups": len(conflict_groups),
            "filters_applied": {
                "status_filter": status_filter,
                "metric_key":    metric_key,
            },
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
                    "conflict_group_id": r.get("conflict_group_id"),
                }
                for r in rules
            ],
        }

    async def _get_rules_summary(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns rule counts grouped by status.
        Enables answering: 'How many rules are waiting for review?',
        'How many rules have been approved?', 'Are there conflicting rules?'
        """
        counts = await self._repo.get_rules_status_summary(self._project_id)
        total = sum(counts.values())

        if total == 0:
            return {
                "status": "ok",
                "total": 0,
                "by_status": {},
                "note": "No extracted rules found for this project yet.",
            }

        # Count conflict groups across all rules (need a separate query)
        all_rules = await self._repo.get_all_extracted_rules(
            self._project_id, limit=200
        )
        conflict_groups = set(
            r["conflict_group_id"] for r in all_rules
            if r.get("conflict_group_id")
        )

        # Human-friendly counts
        pending_review = (
            counts.get("draft", 0)
        )
        approved = (
            counts.get("approved", 0)
            + counts.get("reviewed", 0)
            + counts.get("auto_approved", 0)
        )

        return {
            "status":             "ok",
            "total":              total,
            "pending_review":     pending_review,
            "approved":           approved,
            "rejected":           counts.get("rejected", 0),
            "superseded":         counts.get("superseded", 0),
            "conflict_groups":    len(conflict_groups),
            "by_status":          counts,
        }

    async def _get_viewer_selection(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns the Speckle objects currently selected in the 3D viewer.
        Selected object IDs are forwarded via ui_context.selected_object_ids.
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
        Semantic search over project document chunks via pgvector.

        Uses CopilotRetriever.retrieve_chunks() which:
          1. Embeds the query via OpenAI text-embedding-3-small
          2. Calls match_document_chunks() RPC in Supabase
          3. Returns ranked RetrievedChunk objects with source metadata

        Degrades gracefully when OPENAI_API_KEY is not set or pgvector
        migration has not been applied:
          - partial: OPENAI_API_KEY not set or no embeddings yet
          - not_ready: no documents uploaded at all

        Schema: migration 20240301000001 + 20240301000016
        """
        query: str = args.get("query", "").strip()
        if not query:
            return {"status": "error", "reason": "query is required"}

        top_k = min(int(args.get("top_k") or 5), 10)
        threshold = float(
            args.get("similarity_threshold")
            or 0.50
        )
        threshold = max(0.0, min(1.0, threshold))

        # Check that documents exist at all
        docs = await self._repo.get_uploaded_documents(
            self._project_id, limit=5
        )
        if not docs:
            return {
                "status":  "not_ready",
                "query":   query,
                "results": [],
                "note": (
                    "No documents have been uploaded to this project yet. "
                    "Upload zoning codes or project documents to enable "
                    "document search."
                ),
            }

        # If no retriever is available, fall back gracefully
        if self._retriever is None:
            doc_names = [d["file_name"] for d in docs]
            return {
                "status": "partial",
                "query":  query,
                "results": [],
                "document_titles": doc_names,
                "note": (
                    "Document search is not available in this context. "
                    f"Project has {len(docs)} document(s): "
                    + ", ".join(doc_names)
                ),
            }

        from app.core.config import settings as _settings  # avoid circular
        if not _settings.openai_api_key:
            doc_names = [d["file_name"] for d in docs]
            return {
                "status": "partial",
                "query":  query,
                "results": [],
                "document_titles": doc_names,
                "note": (
                    "Semantic search requires OPENAI_API_KEY to be set. "
                    f"The project has {len(docs)} uploaded document(s): "
                    + ", ".join(doc_names)
                    + ". Set OPENAI_API_KEY in backend/.env to activate "
                    "pgvector-backed search."
                ),
            }

        chunks = await self._retriever.retrieve_chunks(
            project_id=self._project_id,
            query=query,
            top_k=top_k,
            similarity_threshold=threshold,
        )

        if not chunks:
            doc_names = [d["file_name"] for d in docs]
            return {
                "status":          "ok",
                "query":           query,
                "result_count":    0,
                "results":         [],
                "document_titles": doc_names,
                "note": (
                    f"No passages found matching '{query}' above similarity "
                    f"threshold {threshold:.0%}. "
                    "Try a broader query, or lower the similarity_threshold. "
                    "Documents may not be embedded yet — run the backfill "
                    "script if you recently uploaded documents."
                ),
            }

        log.debug(
            "_search_project_docs: project=%s query=%r "
            "matched=%d top_sim=%.3f",
            self._project_id, query,
            len(chunks), chunks[0].similarity,
        )

        return {
            "status":       "ok",
            "query":        query,
            "result_count": len(chunks),
            "results": [c.as_tool_result() for c in chunks],
            "retrieval_source": "pgvector",
        }

    async def _list_documents(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns uploaded documents with filenames, types, and upload timestamps.
        Schema: migration 20240301000001 uploaded_documents.
          file_name (not filename), uploaded_at (not created_at)
        """
        docs = await self._repo.get_uploaded_documents(self._project_id, limit=20)
        if not docs:
            return {
                "status":    "ok",
                "documents": [],
                "note":      "No documents have been uploaded to this project yet.",
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
        Returns the active Speckle model for the project.
        Schema: migration 20240301000001 speckle_model_refs +
                migration 20240301000008 (active_model_ref_id on projects) +
                migration 20240301000012 (synced_at on speckle_model_refs)
        """
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

        active_ref = await self._repo.get_active_model_ref_for_project(self._project_id)
        is_same = active_ref is not None and active_ref.get("id") == str(model_ref_id)
        return {
            "status":       "ok",
            "source":       source,
            "model_ref_id": str(model_ref_id),
            "model_name": active_ref.get("model_name") if is_same and active_ref else None,
            "stream_id":  active_ref.get("stream_id")  if is_same and active_ref else None,
            "synced_at":  active_ref.get("synced_at")  if is_same and active_ref else None,
        }

    async def _list_project_models(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns all Speckle model references for the project.
        Also indicates which one is the project's active model.

        Schema source: migration 20240301000001 speckle_model_refs +
                       migration 20240301000008 (active_model_ref_id on projects) +
                       migration 20240301000012 (synced_at)
        """
        refs = await self._repo.get_speckle_model_refs(self._project_id)

        if not refs:
            return {
                "status": "ok",
                "models": [],
                "note": (
                    "No Speckle models have been linked to this project yet. "
                    "Go to the Models page to add a Speckle stream."
                ),
            }

        # Determine active model ref id from project or viewer context
        active_ref = await self._repo.get_active_model_ref_for_project(self._project_id)
        active_id: str | None = active_ref["id"] if active_ref else None
        # Viewer may override
        if self._active_model_ref_id:
            active_id = str(self._active_model_ref_id)

        log.debug(
            "list_project_models: project=%s model_count=%d active=%s",
            self._project_id, len(refs), active_id,
        )

        return {
            "status":      "ok",
            "model_count": len(refs),
            "active_model_ref_id": active_id,
            "models": [
                {
                    "id":           ref["id"],
                    "model_name":   ref.get("model_name"),
                    "stream_id":    ref["stream_id"],
                    "version_id":   ref["version_id"],
                    "branch_name":  ref.get("branch_name"),
                    "synced_at":    ref.get("synced_at"),
                    "selected_at":  ref.get("selected_at"),
                    "is_active":    ref["id"] == active_id,
                }
                for ref in refs
            ],
        }

    # ── Notes tool handlers ───────────────────────────────────

    def _require_user_id(self, tool_name: str) -> UUID | None:
        """Returns user_id or logs a warning if missing (notes require it)."""
        if self._user_id is None:
            log.warning("%s: user_id not available — notes query may return empty", tool_name)
        return self._user_id

    async def _list_project_notes(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns all user notes for the project, pinned first.
        Schema: migration 20240301000015_project_notes.sql
        """
        user_id = self._require_user_id("list_project_notes")
        if user_id is None:
            return {"status": "error", "reason": "User context not available"}

        limit = min(int(args.get("limit") or 20), 50)
        notes = await self._repo.list_project_notes(
            project_id=self._project_id,
            user_id=user_id,
            limit=limit,
        )

        if not notes:
            return {
                "status": "ok",
                "notes":  [],
                "note":   "No project notes yet. Create notes from the Project Overview page or by pinning a Copilot answer.",
            }

        return {
            "status":     "ok",
            "note_count": len(notes),
            "notes": [
                {
                    "id":          n["id"],
                    "title":       n["title"],
                    "content":     n["content"],
                    "pinned":      n["pinned"],
                    "source_type": n["source_type"],
                    "updated_at":  n["updated_at"],
                }
                for n in notes
            ],
        }

    async def _search_project_notes(self, args: dict[str, Any]) -> dict[str, Any]:
        """
        Keyword search across note title and content (ilike).
        Schema: migration 20240301000015_project_notes.sql
        """
        user_id = self._require_user_id("search_project_notes")
        if user_id is None:
            return {"status": "error", "reason": "User context not available"}

        query: str = args.get("query", "").strip()
        if not query:
            return {"status": "error", "reason": "query is required"}

        limit = min(int(args.get("limit") or 10), 20)
        notes = await self._repo.search_notes(
            project_id=self._project_id,
            user_id=user_id,
            query=query,
            limit=limit,
        )

        if not notes:
            return {
                "status": "ok",
                "query":  query,
                "notes":  [],
                "note":   f"No notes matching '{query}' found.",
            }

        return {
            "status":     "ok",
            "query":      query,
            "note_count": len(notes),
            "notes": [
                {
                    "id":          n["id"],
                    "title":       n["title"],
                    "content":     n["content"],
                    "pinned":      n["pinned"],
                    "source_type": n["source_type"],
                    "updated_at":  n["updated_at"],
                }
                for n in notes
            ],
        }

    async def _get_pinned_notes(self, _args: dict[str, Any]) -> dict[str, Any]:
        """
        Returns only pinned notes for the project.
        Schema: migration 20240301000015_project_notes.sql
        """
        user_id = self._require_user_id("get_pinned_notes")
        if user_id is None:
            return {"status": "error", "reason": "User context not available"}

        notes = await self._repo.get_pinned_notes(
            project_id=self._project_id,
            user_id=user_id,
        )

        if not notes:
            return {
                "status": "ok",
                "notes":  [],
                "note":   "No pinned notes. Pin a note from the Project Overview page to surface it here.",
            }

        return {
            "status":     "ok",
            "note_count": len(notes),
            "notes": [
                {
                    "id":          n["id"],
                    "title":       n["title"],
                    "content":     n["content"],
                    "source_type": n["source_type"],
                    "updated_at":  n["updated_at"],
                }
                for n in notes
            ],
        }
