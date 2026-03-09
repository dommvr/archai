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