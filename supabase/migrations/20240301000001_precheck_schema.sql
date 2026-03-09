-- ============================================================
-- Tool 1: Smart Zoning & Code Checker — Precheck Schema
-- Migration: 20240301000001_precheck_schema.sql
--
-- Assumptions:
--   • public.projects(id uuid primary key) exists
--   • auth.users (Supabase built-in) exists
--   • pgvector extension not yet enabled (see § document_chunks for migration path)
--   • PostGIS not required — all geometry stored as JSONB GeoJSON objects
--   • Supabase Postgres >= 15
--
-- Canonical TypeScript contracts live in lib/precheck/
--   constants.ts → enum values
--   schemas.ts   → Zod shapes (source of truth for column semantics)
--   types.ts     → inferred TS types
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1.  ENUM TYPES
--     Values mirror the `as const` arrays in lib/precheck/constants.ts
-- ════════════════════════════════════════════════════════════

-- Maps to: PRECHECK_RUN_STATUSES
create type public.precheck_run_status as enum (
  'created',
  'ingesting_site',
  'ingesting_docs',
  'extracting_rules',
  'syncing_model',
  'computing_metrics',
  'evaluating',
  'generating_report',
  'completed',
  'failed'
);

-- Maps to: RULE_STATUSES
create type public.rule_status as enum (
  'draft',
  'reviewed',
  'rejected'
);

-- Maps to: ISSUE_SEVERITIES
create type public.issue_severity as enum (
  'info',
  'warning',
  'error',
  'critical'
);

-- Maps to: CHECK_RESULT_STATUSES
create type public.check_result_status as enum (
  'pass',
  'fail',
  'ambiguous',
  'not_applicable',
  'missing_input'
);

-- Maps to: METRIC_KEYS
-- V1 rule scope: height, setbacks, FAR, lot coverage, parking
create type public.metric_key as enum (
  'building_height_m',
  'front_setback_m',
  'side_setback_left_m',
  'side_setback_right_m',
  'rear_setback_m',
  'gross_floor_area_m2',
  'far',
  'lot_coverage_pct',
  'parking_spaces_required',
  'parking_spaces_provided'
);

-- Maps to: CHECKLIST_CATEGORIES
create type public.checklist_category as enum (
  'site_data',
  'zoning_data',
  'model_data',
  'rules_data',
  'submission_data'
);

-- Maps to: UploadedDocumentSchema.documentType
create type public.document_type as enum (
  'zoning_code',
  'building_code',
  'project_doc',
  'other'
);

-- Maps to: ExtractedRuleSchema.operator
create type public.rule_operator as enum (
  '<',
  '<=',
  '>',
  '>=',
  '=',
  'between'
);


-- ════════════════════════════════════════════════════════════
-- 2.  UPDATED_AT TRIGGER HELPER
-- ════════════════════════════════════════════════════════════

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ════════════════════════════════════════════════════════════
-- 3.  SITE_CONTEXTS
--     Maps to: SiteContextSchema + SiteDataProviderServiceContract
-- ════════════════════════════════════════════════════════════

create table public.site_contexts (
  id                uuid        primary key default gen_random_uuid(),

  -- Ownership
  project_id        uuid        not null
                    references public.projects(id) on delete cascade,

  -- Address & jurisdiction fields
  -- Maps to: SiteContextSchema.address, .municipality, .jurisdictionCode, .zoningDistrict
  address           text,
  municipality      text,
  jurisdiction_code text,
  zoning_district   text,

  -- Overlay zones (e.g. flood zone, historic district) — text array
  -- Maps to: SiteContextSchema.overlays (string[])
  overlays          text[]      not null default '{}',

  -- Parcel reference from external provider (e.g. Regrid parcel ID)
  -- Maps to: SiteContextSchema.parcelId
  parcel_id         text,

  -- Parcel area in square metres
  -- Maps to: SiteContextSchema.parcelAreaM2
  parcel_area_m2    numeric,

  -- Centroid as {lat, lng} JSON object — maps to LatLngSchema
  -- Example: {"lat": 40.7128, "lng": -74.0060}
  centroid          jsonb,

  -- Parcel boundary as GeoJSON Polygon — maps to PolygonSchema
  -- Example: {"type": "Polygon", "coordinates": [[[lng, lat], ...]]}
  -- Future: migrate to geometry(Polygon, 4326) when PostGIS is enabled
  parcel_boundary   jsonb,

  -- Which external data provider populated this row (e.g. "regrid", "zoneomics", "manual")
  -- Maps to: SiteContextSchema.sourceProvider
  source_provider   text        not null,

  -- Raw API response for reprocessing without re-fetching
  -- Maps to: SiteContextSchema.rawSourceData (unknown → JSONB)
  raw_source_data   jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_site_contexts_project_id    on public.site_contexts(project_id);
create index idx_site_contexts_jurisdiction  on public.site_contexts(jurisdiction_code)
  where jurisdiction_code is not null;
create index idx_site_contexts_parcel_id     on public.site_contexts(parcel_id)
  where parcel_id is not null;

create trigger trg_site_contexts_updated_at
  before update on public.site_contexts
  for each row execute function public.set_updated_at();


-- ════════════════════════════════════════════════════════════
-- 4.  SPECKLE_MODEL_REFS
--     Maps to: SpeckleModelRefSchema + SpeckleServiceContract
-- ════════════════════════════════════════════════════════════

create table public.speckle_model_refs (
  id             uuid        primary key default gen_random_uuid(),
  project_id     uuid        not null
                 references public.projects(id) on delete cascade,

  -- Maps to: SpeckleModelRefSchema.streamId, .branchName, .versionId
  stream_id      text        not null,
  branch_name    text,
  version_id     text        not null,

  -- Human-readable model label (e.g. "Tower Option A")
  -- Maps to: SpeckleModelRefSchema.modelName
  model_name     text,

  -- Speckle commit message
  -- Maps to: SpeckleModelRefSchema.commitMessage
  commit_message text,

  -- When this version was selected/synced
  -- Maps to: SpeckleModelRefSchema.selectedAt
  selected_at    timestamptz not null default now()
);

create index idx_speckle_model_refs_project_id on public.speckle_model_refs(project_id);
create index idx_speckle_model_refs_stream_id  on public.speckle_model_refs(stream_id);
create index idx_speckle_model_refs_version_id on public.speckle_model_refs(stream_id, version_id);


-- ════════════════════════════════════════════════════════════
-- 5.  PRECHECK_RUNS
--     Maps to: PrecheckRunSchema
--     Central table — all other Tool 1 tables reference run_id
-- ════════════════════════════════════════════════════════════

create table public.precheck_runs (
  id                   uuid                       primary key default gen_random_uuid(),

  -- Ownership
  project_id           uuid                       not null
                       references public.projects(id) on delete cascade,

  -- Optional: set when site context ingestion completes
  -- Maps to: PrecheckRunSchema.siteContextId
  site_context_id      uuid
                       references public.site_contexts(id) on delete set null,

  -- Optional: set when Speckle model is synced
  -- Maps to: PrecheckRunSchema.speckleModelRefId
  speckle_model_ref_id uuid
                       references public.speckle_model_refs(id) on delete set null,

  -- Pipeline state machine
  -- Maps to: PrecheckRunSchema.status
  status               public.precheck_run_status not null default 'created',

  -- Computed by lib/precheck/scoring.ts → calculateReadinessScore()
  -- Stored here after evaluation; 0–100 integer, nullable until evaluated
  -- Maps to: PrecheckRunSchema.readinessScore
  readiness_score      smallint
                       check (readiness_score between 0 and 100),

  -- Current pipeline sub-step label for UI display
  -- Maps to: PrecheckRunSchema.currentStep
  current_step         text,

  -- Populated on status = 'failed'
  -- Maps to: PrecheckRunSchema.errorMessage
  error_message        text,

  -- The Supabase user who triggered the run
  -- Maps to: PrecheckRunSchema.createdBy
  created_by           uuid                       not null
                       references auth.users(id) on delete restrict,

  created_at           timestamptz                not null default now(),
  updated_at           timestamptz                not null default now()
);

create index idx_precheck_runs_project_id     on public.precheck_runs(project_id);
create index idx_precheck_runs_created_by     on public.precheck_runs(created_by);
create index idx_precheck_runs_status         on public.precheck_runs(status);
create index idx_precheck_runs_created_at     on public.precheck_runs(created_at desc);

-- Primary query: "show me recent runs for this project"
create index idx_precheck_runs_project_recent on public.precheck_runs(project_id, created_at desc);

create trigger trg_precheck_runs_updated_at
  before update on public.precheck_runs
  for each row execute function public.set_updated_at();


-- ════════════════════════════════════════════════════════════
-- 6.  UPLOADED_DOCUMENTS
--     Maps to: UploadedDocumentSchema + DocumentIngestionServiceContract
-- ════════════════════════════════════════════════════════════

create table public.uploaded_documents (
  id                uuid                 primary key default gen_random_uuid(),

  -- Documents can be uploaded at project level before a run starts,
  -- or directly tied to a run. run_id is optional.
  project_id        uuid                 not null
                    references public.projects(id) on delete cascade,

  -- Maps to: UploadedDocumentSchema.runId (optional)
  run_id            uuid
                    references public.precheck_runs(id) on delete set null,

  -- Supabase Storage object path (e.g. "projects/{project_id}/docs/{id}.pdf")
  -- Maps to: UploadedDocumentSchema.storagePath
  storage_path      text                 not null unique,

  -- Maps to: UploadedDocumentSchema.fileName, .mimeType
  file_name         text                 not null,
  mime_type         text                 not null,

  -- Maps to: UploadedDocumentSchema.documentType
  document_type     public.document_type not null default 'other',

  -- Jurisdiction this document applies to (optional)
  -- Maps to: UploadedDocumentSchema.jurisdictionCode
  jurisdiction_code text,

  -- Maps to: UploadedDocumentSchema.uploadedAt
  uploaded_at       timestamptz          not null default now()
);

create index idx_uploaded_documents_project_id on public.uploaded_documents(project_id);
create index idx_uploaded_documents_run_id     on public.uploaded_documents(run_id)
  where run_id is not null;
create index idx_uploaded_documents_doc_type   on public.uploaded_documents(document_type);


-- ════════════════════════════════════════════════════════════
-- 7.  DOCUMENT_CHUNKS
--     Maps to: DocumentChunkSchema + DocumentIngestionServiceContract
--
--     PGVECTOR MIGRATION PATH:
--       1. Run: create extension if not exists vector;
--       2. Run: alter table public.document_chunks
--                 add column embedding vector(1536);
--       3. Run index: create index ... using hnsw (embedding vector_cosine_ops);
--       4. Drop embedding_raw column once pipeline stores vector data.
-- ════════════════════════════════════════════════════════════

create table public.document_chunks (
  id            uuid        primary key default gen_random_uuid(),

  -- Maps to: DocumentChunkSchema.documentId
  document_id   uuid        not null
                references public.uploaded_documents(id) on delete cascade,

  -- Maps to: DocumentChunkSchema.page (nonnegative int, optional)
  page          integer     check (page >= 0),

  -- Maps to: DocumentChunkSchema.section (optional)
  section       text,

  -- Maps to: DocumentChunkSchema.chunkIndex (sequential within document)
  chunk_index   integer     not null check (chunk_index >= 0),

  -- The text content of this chunk
  -- Maps to: DocumentChunkSchema.text
  chunk_text    text        not null,

  -- Interim embedding storage as a float array (no extension required).
  -- Replace with embedding vector(1536) when pgvector is enabled.
  -- Maps to: DocumentChunkSchema.embedding (number[])
  embedding_raw real[],

  -- Arbitrary pipeline metadata (e.g. token count, language, model used)
  -- Maps to: DocumentChunkSchema.metadata (Record<string, unknown>)
  metadata      jsonb,

  created_at    timestamptz not null default now(),

  unique (document_id, chunk_index)
);

create index idx_document_chunks_document_id on public.document_chunks(document_id);
create index idx_document_chunks_section     on public.document_chunks(document_id, section)
  where section is not null;

-- Future pgvector index (uncomment after: alter table ... add column embedding vector(1536)):
-- create index idx_document_chunks_embedding
--   on public.document_chunks using hnsw (embedding vector_cosine_ops);


-- ════════════════════════════════════════════════════════════
-- 8.  EXTRACTED_RULES
--     Maps to: ExtractedRuleSchema + RuleExtractionServiceContract
--     Central lookup table for the rule engine (lib/precheck/rule-engine.ts)
-- ════════════════════════════════════════════════════════════

create table public.extracted_rules (
  id                uuid                 primary key default gen_random_uuid(),

  -- Maps to: ExtractedRuleSchema.projectId, .documentId
  project_id        uuid                 not null
                    references public.projects(id) on delete cascade,
  document_id       uuid                 not null
                    references public.uploaded_documents(id) on delete restrict,
  -- ON DELETE RESTRICT: rules reference source documents; prefer soft-deletes for documents.

  -- Structured rule identifier from the source document (e.g. "§ 33-26(a)")
  -- Maps to: ExtractedRuleSchema.ruleCode
  rule_code         text                 not null,

  -- Maps to: ExtractedRuleSchema.title, .description
  title             text                 not null,
  description       text,

  -- Which spatial/zoning metric this rule constrains
  -- Maps to: ExtractedRuleSchema.metricKey
  metric_key        public.metric_key    not null,

  -- Comparison operator — consumed by evaluateRule() in rule-engine.ts
  -- Maps to: ExtractedRuleSchema.operator
  operator          public.rule_operator not null,

  -- Single-value threshold (for <, <=, >, >=, =)
  -- Maps to: ExtractedRuleSchema.valueNumber
  value_number      numeric,

  -- Range bounds (for 'between')
  -- Maps to: ExtractedRuleSchema.valueMin, .valueMax
  value_min         numeric,
  value_max         numeric,

  -- Physical unit label (e.g. "m", "%", "m²")
  -- Maps to: ExtractedRuleSchema.units
  units             text,

  -- {jurisdictionCode?, zoningDistricts[], buildingTypes[], occupancies[]}
  -- Maps to: ApplicabilitySchema
  applicability     jsonb                not null default '{}',

  -- {documentId, page?, section?, snippet, chunkId?}
  -- Maps to: RuleCitationSchema
  citation          jsonb                not null,

  -- LLM extraction confidence 0.0–1.0
  -- Maps to: ExtractedRuleSchema.confidence
  confidence        numeric              not null
                    check (confidence between 0 and 1),

  -- Lifecycle: draft → reviewed → rejected
  -- Maps to: ExtractedRuleSchema.status (RULE_STATUSES)
  -- markRuleStatus() in RuleExtractionServiceContract writes here
  status            public.rule_status   not null default 'draft',

  -- Notes from the extraction agent about ambiguity or caveats
  -- Maps to: ExtractedRuleSchema.extractionNotes
  extraction_notes  text,

  created_at        timestamptz          not null default now(),
  updated_at        timestamptz          not null default now()
);

create index idx_extracted_rules_project_id  on public.extracted_rules(project_id);
create index idx_extracted_rules_document_id on public.extracted_rules(document_id);
create index idx_extracted_rules_metric_key  on public.extracted_rules(metric_key);
create index idx_extracted_rules_status      on public.extracted_rules(status);

-- Query pattern: find rules for a specific jurisdiction
create index idx_extracted_rules_jurisdiction
  on public.extracted_rules((applicability->>'jurisdictionCode'))
  where applicability->>'jurisdictionCode' is not null;

-- Query pattern: trace issue back to source document via citation
create index idx_extracted_rules_citation_doc
  on public.extracted_rules((citation->>'documentId'));

create trigger trg_extracted_rules_updated_at
  before update on public.extracted_rules
  for each row execute function public.set_updated_at();


-- ════════════════════════════════════════════════════════════
-- 9.  GEOMETRY_SNAPSHOTS
--     Maps to: GeometrySnapshotSchema + SpeckleServiceContract.deriveGeometrySnapshot
--     Derived geometry state from a specific Speckle model version.
--     Used as input to the rule engine (RuleEvaluationContext.geometrySnapshot).
-- ════════════════════════════════════════════════════════════

create table public.geometry_snapshots (
  id                   uuid        primary key default gen_random_uuid(),

  -- Maps to: GeometrySnapshotSchema.projectId, .runId, .speckleModelRefId
  project_id           uuid        not null
                       references public.projects(id) on delete cascade,
  run_id               uuid        not null
                       references public.precheck_runs(id) on delete cascade,
  speckle_model_ref_id uuid        not null
                       references public.speckle_model_refs(id) on delete restrict,

  -- Site boundary polygon for lot coverage computation — GeoJSON Polygon or null
  -- Maps to: GeometrySnapshotSchema.siteBoundary (PolygonSchema | undefined)
  site_boundary        jsonb,

  -- Building footprints array: [{objectId, polygon, level?}]
  -- Maps to: GeometrySnapshotSchema.buildingFootprints
  building_footprints  jsonb       not null default '[]',

  -- Floor plate data: [{level, areaM2, objectIds[]}]
  -- Used to compute gross_floor_area_m2 and FAR
  -- Maps to: GeometrySnapshotSchema.floors
  floors               jsonb       not null default '[]',

  -- Computed metric values: [{key, value, units?, sourceObjectIds[], computationNotes?}]
  -- Maps to: GeometrySnapshotSchema.metrics (GeometrySnapshotMetricSchema[])
  -- This is the primary input to MetricMap in the rule engine
  metrics              jsonb       not null default '[]',

  -- Raw/extra metrics that don't map to a typed metric_key
  -- Maps to: GeometrySnapshotSchema.rawMetrics (Record<string, unknown>)
  raw_metrics          jsonb       not null default '{}',

  created_at           timestamptz not null default now()
);

create index idx_geometry_snapshots_project_id on public.geometry_snapshots(project_id);
create index idx_geometry_snapshots_run_id     on public.geometry_snapshots(run_id);
create index idx_geometry_snapshots_model_ref  on public.geometry_snapshots(speckle_model_ref_id);

-- Only the latest snapshot per run is authoritative.
-- No uniqueness constraint enforced at DB level — application selects latest by created_at.
-- To enforce "one snapshot per run" policy, add:
--   create unique index idx_geometry_snapshots_run_unique on public.geometry_snapshots(run_id);


-- ════════════════════════════════════════════════════════════
-- 10. COMPLIANCE_CHECKS
--     Maps to: ComplianceCheckSchema
--     One row per (run, rule) pair — deterministic evaluation output.
--     Written by ComplianceEngineServiceContract.evaluateRules()
-- ════════════════════════════════════════════════════════════

create table public.compliance_checks (
  id             uuid                       primary key default gen_random_uuid(),

  -- Maps to: ComplianceCheckSchema.runId, .ruleId
  run_id         uuid                       not null
                 references public.precheck_runs(id)   on delete cascade,
  rule_id        uuid                       not null
                 references public.extracted_rules(id) on delete cascade,

  -- Maps to: ComplianceCheckSchema.metricKey
  metric_key     public.metric_key          not null,

  -- Pass/fail/ambiguous/missing_input in the V1 engine flow.
  -- not_applicable remains a reserved enum value for future audit/reporting paths;
  -- current evaluation filters non-applicable rules before checks are written.
  -- Maps to: ComplianceCheckSchema.status (CHECK_RESULT_STATUSES)
  status         public.check_result_status not null,

  -- Measured value from the geometry snapshot
  -- Maps to: ComplianceCheckSchema.actualValue
  actual_value   numeric,

  -- Threshold value for single-value rules
  -- Maps to: ComplianceCheckSchema.expectedValue
  expected_value numeric,

  -- Range bounds for 'between' rules
  -- Maps to: ComplianceCheckSchema.expectedMin, .expectedMax
  expected_min   numeric,
  expected_max   numeric,

  -- Maps to: ComplianceCheckSchema.units
  units          text,

  created_at     timestamptz                not null default now(),

  -- A run evaluates each rule exactly once
  unique (run_id, rule_id)
);

create index idx_compliance_checks_run_id   on public.compliance_checks(run_id);
create index idx_compliance_checks_rule_id  on public.compliance_checks(rule_id);
create index idx_compliance_checks_status   on public.compliance_checks(run_id, status);


-- ════════════════════════════════════════════════════════════
-- 11. COMPLIANCE_ISSUES
--     Maps to: ComplianceIssueSchema
--     Presentation layer on top of compliance_checks.
--     Written by ComplianceEngineServiceContract.generateIssues()
--     V1 persists only actionable issues (fail / ambiguous / missing_input).
--     Consumed by PrecheckWorkspace → ComplianceIssuesTable / ComplianceIssueDrawer
-- ════════════════════════════════════════════════════════════

create table public.compliance_issues (
  id                  uuid                       primary key default gen_random_uuid(),

  -- Maps to: ComplianceIssueSchema.runId
  run_id              uuid                       not null
                      references public.precheck_runs(id) on delete cascade,

  -- Optional links back to the source rule and deterministic check
  -- Maps to: ComplianceIssueSchema.ruleId, .checkId
  rule_id             uuid
                      references public.extracted_rules(id)  on delete set null,
  check_id            uuid
                      references public.compliance_checks(id) on delete set null,

  -- Maps to: ComplianceIssueSchema.severity (ISSUE_SEVERITIES)
  -- Drives penalty in calculateReadinessScore() in lib/precheck/scoring.ts
  severity            public.issue_severity      not null,

  -- Maps to: ComplianceIssueSchema.title, .summary, .explanation
  title               text                       not null,
  summary             text                       not null,
  explanation         text,

  -- Maps to: ComplianceIssueSchema.status (CHECK_RESULT_STATUSES)
  status              public.check_result_status not null,

  -- Maps to: ComplianceIssueSchema.metricKey (optional)
  metric_key          public.metric_key,

  -- Measured vs allowed value fields
  -- Maps to: ComplianceIssueSchema.actualValue, .expectedValue, .expectedMin, .expectedMax, .units
  actual_value        numeric,
  expected_value      numeric,
  expected_min        numeric,
  expected_max        numeric,
  units               text,

  -- Source citation for the violated rule — GeoJSON Polygon or null
  -- Maps to: ComplianceIssueSchema.citation (RuleCitationSchema | undefined → JSONB)
  citation            jsonb,

  -- Speckle object IDs whose geometry is implicated (for viewer highlight)
  -- Maps to: ComplianceIssueSchema.affectedObjectIds (string[])
  -- Used by ViewerAnnotationController.tsx to drive viewer.highlightObjects()
  affected_object_ids text[]                     not null default '{}',

  -- Optional polygon highlighting affected area — GeoJSON Polygon
  -- Maps to: ComplianceIssueSchema.affectedGeometry (PolygonSchema | undefined)
  affected_geometry   jsonb,

  created_at          timestamptz                not null default now()
);

create index idx_compliance_issues_run_id   on public.compliance_issues(run_id);
create index idx_compliance_issues_severity on public.compliance_issues(run_id, severity);
create index idx_compliance_issues_status   on public.compliance_issues(run_id, status);
create index idx_compliance_issues_rule_id  on public.compliance_issues(rule_id)
  where rule_id is not null;

-- For viewer highlight queries: "find issues touching object X"
create index idx_compliance_issues_objects  on public.compliance_issues
  using gin (affected_object_ids);


-- ════════════════════════════════════════════════════════════
-- 12. PERMIT_CHECKLIST_ITEMS
--     Maps to: PermitChecklistItemSchema
--     Generated by ComplianceEngineServiceContract.generateChecklist()
--     Consumed by PermitChecklistCard.tsx
-- ════════════════════════════════════════════════════════════

create table public.permit_checklist_items (
  id          uuid                      primary key default gen_random_uuid(),

  -- Maps to: PermitChecklistItemSchema.runId
  run_id      uuid                      not null
              references public.precheck_runs(id) on delete cascade,

  -- Maps to: PermitChecklistItemSchema.category (CHECKLIST_CATEGORIES)
  category    public.checklist_category not null,

  -- Maps to: PermitChecklistItemSchema.title, .description
  title       text                      not null,
  description text,

  -- Maps to: PermitChecklistItemSchema.required (default true)
  required    boolean                   not null default true,

  -- Maps to: PermitChecklistItemSchema.resolved (default false)
  -- Updated by frontend or backend when item is actioned
  resolved    boolean                   not null default false,

  created_at  timestamptz               not null default now()
);

create index idx_permit_checklist_run_id      on public.permit_checklist_items(run_id);
create index idx_permit_checklist_category    on public.permit_checklist_items(run_id, category);
create index idx_permit_checklist_unresolved  on public.permit_checklist_items(run_id, resolved)
  where resolved = false;


-- ════════════════════════════════════════════════════════════
-- 13. ROW-LEVEL SECURITY
--
--     Policy model: users can access data within projects they own.
--     Assumes public.projects.user_id references auth.users(id).
--     Adjust the project ownership check to your actual projects schema.
-- ════════════════════════════════════════════════════════════

alter table public.site_contexts          enable row level security;
alter table public.speckle_model_refs     enable row level security;
alter table public.precheck_runs          enable row level security;
alter table public.uploaded_documents     enable row level security;
alter table public.document_chunks        enable row level security;
alter table public.extracted_rules        enable row level security;
alter table public.geometry_snapshots     enable row level security;
alter table public.compliance_checks      enable row level security;
alter table public.compliance_issues      enable row level security;
alter table public.permit_checklist_items enable row level security;

-- ── RLS helper: is this the user's project? ──────────────────
-- Inline sub-select pattern — avoids a separate function for portability.
--
-- Template policy (apply per table):
--
-- create policy "owner_access" on public.<table>
--   for all
--   using (
--     project_id in (
--       select id from public.projects where user_id = auth.uid()
--     )
--   )
--   with check (
--     project_id in (
--       select id from public.projects where user_id = auth.uid()
--     )
--   );
--
-- For document_chunks and tables without direct project_id, join through parent:
--
-- create policy "owner_access" on public.document_chunks
--   for all
--   using (
--     document_id in (
--       select id from public.uploaded_documents
--       where project_id in (
--         select id from public.projects where user_id = auth.uid()
--       )
--     )
--   );
--
-- Note: The server-side Supabase client (lib/supabase/server.ts) uses the
-- service-role key or a user session JWT. FastAPI should pass the JWT in
-- Authorization: Bearer so Supabase RLS is enforced server-side too.
-- ─────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════
-- 14. REALTIME (optional)
--
--     Enable Supabase Realtime on precheck_runs so the frontend
--     (RealtimePublisherContract) can push pipeline status updates.
--
-- alter publication supabase_realtime add table public.precheck_runs;
-- alter publication supabase_realtime add table public.compliance_issues;
--
-- Then in the client (hooks or PrecheckWorkspace):
--   supabase.channel('precheck-run-{runId}')
--     .on('postgres_changes', { event: 'UPDATE', schema: 'public',
--         table: 'precheck_runs', filter: `id=eq.${runId}` }, handler)
--     .subscribe()
-- ════════════════════════════════════════════════════════════
