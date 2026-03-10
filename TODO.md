.venv\Scripts\Activate.ps1

# Your personal setup checklist before starting any pass

## Do these once:

### Supabase ready:
- URL
- anon key
- service role key
- JWT secret
- Storage bucket

### Backend ready:
- Python env
- pip install -r requirements.txt
- FastAPI runs locally

### Frontend ready:
- .env.local includes NEXT_PUBLIC_API_URL

### Real data ready:
- one project row
- one real site
- one or two zoning/code PDFs
- one Speckle model/version

### Optional but likely needed later:
- Regrid/Zoneomics keys
- Anthropic or OpenAI key
- OCR dependencies for scanned PDFs

---

# Pass 1: make the boring path real

## Prompt
Use Prompt 1:  
migration/boring end-to-end path

- create run
- list project runs
- get run details
- Next.js → FastAPI proxy
- JWT forwarding
- remove fake local run creation

## What you do yourself

Put backend env vars into `backend/.env`:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_JWT_SECRET

Put frontend env var into `.env.local`:

- NEXT_PUBLIC_API_URL=http://localhost:8000

- Run the SQL migration in Supabase.
- Start FastAPI locally.
- Make sure you have at least one real projects row to attach runs to.

## Tests

- npm run type-check
- npm run build
- Start frontend and backend

In UI:
- create a run
- refresh page
- confirm run still exists
- open run details

- Confirm no fake local run insertion remains

Only move on when create/list/details work end-to-end from database truth.

---

# Pass 2: make site + docs + rules real

## Prompt
Use Prompt 2:  
site ingestion + document upload + chunking + rule extraction

## What you do yourself

- Create the Supabase Storage bucket for precheck documents.

Decide your first site-data provider setup:
- dev/simple: Nominatim
- real parcel/zoning: Regrid and/or Zoneomics, or one city open-data API

Add provider keys if using paid APIs:
- REGRID_API_KEY
- ZONEOMICS_API_KEY

Add LLM key for extraction if you want real extraction now:
- ANTHROPIC_API_KEY or OPENAI_API_KEY

- Prepare one or two real zoning/code PDFs for testing.
- If you want scanned-PDF fallback later, install OCR dependencies yourself.

## Tests

- From UI, ingest a real address/site
- Verify site_contexts row is created and persists after refresh
- Upload a real PDF
- Verify file is in Supabase Storage
- Verify uploaded_documents and document_chunks rows exist
- Run extraction
- Verify extracted_rules rows exist with:
  - citation
  - confidence
  - status
- Refresh and confirm extracted rules still appear

Only move on when site/doc/rule data survives refresh and is DB-backed.

---

# Pass 3: make model sync + evaluation real

## Prompt
Use Prompt 3:  
Speckle sync + geometry snapshot + metrics + deterministic compliance evaluation

## What you do yourself

- Create/get your Speckle account.

Get:
- SPECKLE_SERVER_URL
- SPECKLE_TOKEN

- Prepare one real Speckle stream/model/version to test.
- Decide whether you are using a global backend token or per-user token strategy for now.

Make sure your test project has:
- site context
- extracted rules
- a Speckle model reference

## Tests

- Sync a real model/version from UI
- Verify speckle_model_refs row exists
- Verify geometry_snapshots row exists

Confirm metrics are persisted:
- height
- GFA
- FAR
- setbacks
- lot coverage

- Run evaluation

Verify rows are written to:
- compliance_checks
- compliance_issues
- permit_checklist_items
- precheck_runs.readiness_score

- Refresh UI and confirm score/issues/checklist persist
- Confirm PASS checks are not shown as issues

Only move on when evaluation is fully DB-backed and repeatable.

---

# Pass 4: make realtime + highlighting + hardening real

## Prompt
Use Prompt 4:  
realtime + viewer highlighting seam + security hardening + happy-path verification

## What you do yourself

- Enable Supabase Realtime on the relevant tables if needed.

Decide your security model:
- proper RLS policies
- or backend-only access with service-role pattern

- Implement/approve the actual RLS policies if you choose that route.

Prepare one full happy-path test project with:
- real site
- real docs
- real model
- real extracted rules

## Tests

- Start a run and watch status update without refresh
- Confirm issues and score update live
- Click an issue and confirm highlight state changes
- Confirm selected issue maps to highlightedObjectIds

Verify the happy path end-to-end:
- create run
- ingest site
- upload docs
- extract rules
- sync model
- evaluate
- receive realtime updates
- click issue and see highlight state update

Test auth/access:
- unauthenticated user blocked
- unauthorized project access blocked
- direct table access behaves according to chosen security model

Only call Tool 1 “functional” when this pass works.

# Prompts

## Prompt 1
Read these files first:
- CLAUDE.md
- lib/precheck/*
- lib/actions/tools.ts
- app/api/agents/[tool]/route.ts
- components/dashboard/precheck/PrecheckWorkspace.tsx
- supabase/migrations/20240301000001_precheck_schema.sql
- backend/app/main.py
- backend/app/api/routes/precheck.py
- backend/app/core/auth.py
- backend/app/core/config.py
- backend/app/repositories/precheck_repository.py

Implement only the first production slice of Tool 1:
SMART ZONING & CODE CHECKER + PERMIT PRE-CHECK

Scope for this pass:
1. Apply/finalize the boring end-to-end path:
   - create run
   - list project runs
   - get run details
2. Make the Next.js precheck route proxy to FastAPI for those operations
3. Forward Supabase JWT from Next.js to FastAPI
4. Remove any remaining fake local run creation in PrecheckWorkspace
5. Make backend truth the only source of truth for run list and run details
6. Keep all changes tightly scoped to Tool 1

Requirements:
- Preserve existing dashboard shell and auth flow
- Preserve lib/precheck/* as source of truth
- Keep route handlers thin
- Keep FastAPI service/repository boundaries intact
- Do not implement site ingestion, document extraction, or Speckle in this pass
- Do not refactor unrelated tools
- Do not leave fake stub responses for create/list/details in the precheck route seam

Specifically:
A. Frontend / Next.js
- Update PrecheckWorkspace.tsx to:
  - stop using DEMO_PROJECT_ID
  - derive projectId from props, route params, or existing app context
  - load runs on mount from backend
  - after createPrecheckRun, refresh from backend instead of inserting fabricated local data
  - load selected run details from backend
- Update lib/precheck/api.ts and/or lib/actions/tools.ts so there is one clear orchestration path for Tool 1
- Update app/api/agents/[tool]/route.ts so tool=precheck proxies create/list/details to FastAPI and forwards Authorization bearer token

B. FastAPI
- Ensure these endpoints work end-to-end:
  - POST /precheck/runs
  - GET /projects/{project_id}/precheck-runs
  - GET /precheck/runs/{run_id}
- Ensure JWT verification works with Supabase tokens
- Ensure repository methods for those operations are complete

C. Database
- Ensure the migration is ready to apply without schema/contract mismatch for these operations
- Only make targeted migration fixes if necessary

Deliverables:
1. Exact files changed
2. What is now truly end-to-end functional
3. What remains intentionally placeholder
4. Any env vars required for this pass

Acceptance criteria:
- I can create a run from the UI
- I can refresh and still see the run
- I can fetch run details from backend truth
- No fake local run insertion remains
- TypeScript and Python code compile cleanly

## Prompt 2
Read these files first:
- CLAUDE.md
- lib/precheck/*
- components/dashboard/precheck/*
- app/api/agents/[tool]/route.ts
- backend/app/api/routes/precheck.py
- backend/app/services/site_data_provider.py
- backend/app/services/document_ingestion.py
- backend/app/services/rule_extraction.py
- backend/app/repositories/precheck_repository.py
- supabase/migrations/20240301000001_precheck_schema.sql

Implement the next real production slice of Tool 1:
site ingestion + document ingestion + rule extraction

Scope for this pass:
1. Implement real site ingestion
   - geocoding
   - parcel lookup
   - zoning lookup
   - manual override persistence
2. Implement document upload to Supabase Storage
3. Implement text extraction + chunk storage
4. Implement rule extraction persistence
5. Replace fake extraction behavior with a real first-pass extraction flow
6. Keep the UI wired to backend truth

Requirements:
- Preserve existing architecture
- Keep deterministic measurable compliance logic separate from extraction
- Use one open-data provider path and one paid-provider stub path
- Manual overrides must still work if provider data is incomplete
- Do not implement Speckle sync in this pass
- Do not implement realtime in this pass
- Keep placeholder comments only where truly external integrations remain

Specifically:
A. Frontend
- Wire SiteContextForm to the real ingest-site flow
- Wire DocumentUploadPanel to actual Supabase Storage upload + backend document registration
- Wire RuleExtractionStatusCard to backend extraction status and extracted rule count
- Ensure run details refresh after site/doc/rule actions

B. Next.js route seam
- Proxy these actions to FastAPI:
  - ingest_site
  - ingest_documents
  - extract_rules
- Preserve payload validation with lib/precheck schemas

C. FastAPI
- Implement:
  - POST /precheck/runs/{run_id}/ingest-site
  - POST /precheck/runs/{run_id}/ingest-documents
  - POST /precheck/runs/{run_id}/extract-rules
- site_data_provider.py:
  - real geocoding implementation
  - parcel/zoning provider adapter structure
  - manual override merge strategy
- document_ingestion.py:
  - Supabase Storage-aware document record flow
  - text extraction for text PDFs
  - chunking and chunk persistence
- rule_extraction.py:
  - persist extracted rules
  - keep regex/bootstrap extraction only if LLM extraction is still pending, but structure it so LLM extraction can replace it cleanly
  - store confidence, citation, and status correctly

D. DB/repository
- Ensure site_contexts, uploaded_documents, document_chunks, extracted_rules are fully used
- Fix any field mapping mismatch cleanly

Deliverables:
1. Exact files changed
2. What is now fully functional
3. Which parts still rely on placeholder provider/LLM integrations
4. Any env vars or setup required for this pass

Acceptance criteria:
- I can ingest a site from the UI and see persisted site context
- I can upload a document and have it stored and registered
- I can extract rules and see persisted extracted rules tied to the run/project
- Refreshing the page preserves truth from backend/database

## Prompt 3
Read these files first:
- CLAUDE.md
- lib/precheck/*
- components/dashboard/precheck/*
- app/api/agents/[tool]/route.ts
- backend/app/api/routes/precheck.py
- backend/app/services/speckle_service.py
- backend/app/services/compliance_engine.py
- backend/app/repositories/precheck_repository.py
- supabase/migrations/20240301000001_precheck_schema.sql

Implement the next real production slice of Tool 1:
Speckle sync + geometry snapshot + measurable metrics + deterministic compliance evaluation

Scope for this pass:
1. Implement Speckle model/version sync
2. Persist speckle_model_refs and geometry_snapshots
3. Derive real V1 metrics from synced model/site data
4. Run deterministic compliance evaluation using DB-backed:
   - site context
   - extracted rules
   - geometry snapshot
5. Persist:
   - compliance_checks
   - compliance_issues
   - readiness score
   - permit checklist items
6. Update frontend to display real results from backend

Requirements:
- Preserve deterministic compliance logic
- Do not let LLM alter pass/fail status
- Keep issue-to-object mapping data for viewer sync
- Do not fully mount the real viewer in this pass if not necessary
- Keep route handlers thin and services clear
- Do not emit PASS rows into compliance_issues
- Keep not_applicable semantics consistent with the public contract

Specifically:
A. Frontend
- Wire SpeckleModelPicker to real backend sync action
- Wire evaluate action to backend
- Update ReadinessScoreCard, ComplianceIssuesTable, ComplianceIssueDrawer, PermitChecklistCard, PrecheckProgressCard to use backend truth only

B. Next.js route seam
- Proxy:
  - sync_speckle_model
  - evaluate_compliance
- Preserve auth token forwarding

C. FastAPI
- Implement:
  - POST /precheck/runs/{run_id}/sync-speckle-model
  - POST /precheck/runs/{run_id}/evaluate
- speckle_service.py:
  - fetch model/version metadata
  - fetch object data or leave clearly isolated TODOs only where vendor auth/data specifics are required
  - derive geometry snapshot structure
  - derive V1 metrics:
    - building height
    - front setback
    - side setback left/right
    - rear setback
    - gross floor area
    - FAR
    - lot coverage
    - parking hooks if available
- compliance_engine.py:
  - ensure status semantics match contract
  - no pass-as-issue behavior
  - persist checks/issues/score/checklist cleanly

D. Repository / DB
- fully use:
  - speckle_model_refs
  - geometry_snapshots
  - compliance_checks
  - compliance_issues
  - permit_checklist_items

Deliverables:
1. Exact files changed
2. What is now fully functional
3. Which parts still require external Speckle credentials or deeper geometry logic
4. Any assumptions made for V1 metric derivation

Acceptance criteria:
- I can select/sync a Speckle model/version
- I can run evaluation
- I see persisted issues, score, and checklist from real backend data
- Refreshing preserves all evaluation results

## Prompt 4
Read these files first:
- CLAUDE.md
- lib/precheck/*
- components/dashboard/precheck/*
- app/api/agents/[tool]/route.ts
- lib/supabase/*
- backend/app/services/realtime_publisher.py
- backend/app/services/compliance_engine.py
- backend/app/repositories/precheck_repository.py
- supabase/migrations/20240301000001_precheck_schema.sql

Implement the final production slice of Tool 1:
realtime + viewer highlighting seam + security hardening + happy-path validation

Scope for this pass:
1. Enable realtime updates for:
   - run status
   - readiness score
   - compliance issues
2. Wire issue selection to viewer highlight state and overlay hooks
3. Harden access patterns:
   - RLS policies or explicit backend-only access model
4. Add a real end-to-end happy-path verification path
5. Preserve existing design and architecture

Requirements:
- Keep changes tightly scoped to Tool 1
- Do not refactor unrelated app areas
- Do not fake live updates with timers
- Keep actual viewer mounting isolated if full Speckle viewer integration is still not being completed here
- Make the seam ready and truthful

Specifically:
A. Frontend
- In PrecheckWorkspace or the appropriate client orchestration layer:
  - subscribe to Supabase realtime for run/status/issue changes
  - update UI state from realtime events
  - preserve backend truth as canonical source
- Wire selected issue -> highlightedObjectIds
- Wire site boundary/setback overlay state hooks
- Keep ViewerAnnotationController and PrecheckViewerPanel clean and focused

B. Backend / DB
- Ensure realtime publisher updates the right tables/rows
- If using Supabase realtime via row changes, ensure the relevant tables are publication-ready
- Implement or document the chosen security model:
  - proper RLS policies
  OR
  - backend-only table access using service role with minimal frontend direct access

C. Verification
- Add a concise developer-facing verification checklist or test notes for the happy path:
  - create run
  - ingest site
  - upload docs
  - extract rules
  - sync model
  - evaluate
  - watch realtime updates
  - click issue and see highlight state update

Deliverables:
1. Exact files changed
2. What is now fully functional
3. What remains intentionally non-final
4. Security model used
5. Happy-path verification notes

Acceptance criteria:
- Run status/score/issues update without manual refresh
- Clicking an issue updates highlighted object state
- Access model is explicit and not hand-wavy
- A developer can follow the happy-path checklist and verify Tool 1 end-to-end