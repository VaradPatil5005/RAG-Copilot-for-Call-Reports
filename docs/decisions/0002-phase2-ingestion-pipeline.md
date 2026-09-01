# 0002 — Phase 2 Ingestion Pipeline Design

## Status
Accepted, implemented.

## Context
Phase 2 required an event-driven ingestion pipeline that validates,
extracts, and normalizes uploaded call-report PDFs, per the blueprint's
Section 2 (End-to-End Data Flow) and Section 3 (Layout Extraction). No
Azure subscription exists yet (see ADR 0001), so every Azure service in
the target pipeline needed a local substitute that preserves the same
stage contract and output shape.

## Decisions

### Orchestration: in-process asyncio queue, not Celery/Redis
A single FastAPI process with an `asyncio.Queue` and a small worker pool
(`app/services/pipeline.py`) substitutes Event Grid + Service Bus +
Durable Functions. This was chosen over introducing Redis/Celery because:
- Zero extra infrastructure for local dev.
- The stage contract (queued → validating → extracting → normalizing →
  completed, with quarantined/duplicate/failed/dead-lettered branches) is
  the part that needs to survive the swap to real Azure services later —
  the queue implementation itself is disposable.
- CPU-bound extraction work runs via `loop.run_in_executor` so it doesn't
  block the event loop; upload requests stay responsive while a large PDF
  is being OCR'd.

**Swap-out path**: replace `IngestionQueue.enqueue` with a Service Bus
client call, and replace the worker loop with an Azure Function trigger.
`process_document()` itself is infrastructure-agnostic and needs no
changes.

### Metadata store: SQLite, not Postgres
Substitutes Cosmos DB / Azure SQL. Chosen for zero-setup local dev. All
access goes through `app/db.py` — swapping to Postgres/Cosmos later means
rewriting that one module, not call sites.

### Extraction: PyMuPDF + pdfplumber + Tesseract, not a mocked response
This was the highest-risk substitution to get right, because "fake" layout
extraction would make Phase 3 (retrieval) impossible to validate honestly.
Instead:
- **PyMuPDF (`fitz`)** reads the native text layer with font metadata,
  used for a character-weighted body-font-size estimate and a 3-level
  heading heuristic (`HEADING_RATIO_L1/L2/L3` in `extraction.py`).
- **pdfplumber** extracts table row/column structure per page.
- **Tesseract OCR** (via `pytesseract`, rasterizing pages with PyMuPDF) is
  the fallback whenever a page's native text layer is empty or near-empty
  (< 20 characters) — this is the scanned-page case Section 3 of the
  blueprint calls out. Confidence is captured per OCR'd page from
  Tesseract's word-level confidence scores.
- Embedded images are extracted as figures and separately OCR'd for
  in-image text (chart labels, etc).

This is a genuine extraction pipeline, verified against both a native-text
test PDF (correctly recovered heading hierarchy, section paths, and a
table) and a scanned-image-only test PDF (OCR fallback triggered,
~95% confidence). It is **not** Azure Document Intelligence's ML layout
model — the heading heuristic in particular is a tunable approximation and
should be validated against your real document corpus before being treated
as ground truth.

**Swap-out path**: `extraction.extract()` returns the same canonical
element list regardless of parser. Replacing the body of that function
with an Azure Document Intelligence Layout API call is additive.

### Storage: local filesystem, ADLS-shaped
`data/raw/{tenant}/{document}/{version}/source.pdf` and
`data/derived/{tenant}/{document}/{version}/{manifest,elements}.json` +
`figures/`. Raw PDFs are written once and never overwritten (immutability
matches the blueprint's requirement). This directory shape maps directly
onto ADLS Gen2 containers/paths.

### Idempotency and duplicate detection
SHA-256 of the uploaded file, scoped per tenant, is checked before any
processing starts. An identical re-upload is reported as `duplicate` and
never reprocessed, matching the blueprint's "checksum plus parser/model
version determines whether reprocessing is necessary" rule. Manual
reprocessing is available via `POST /documents/{id}/reprocess?force=true`.

### Failure handling
One retry is attempted in-process on any pipeline exception; a second
failure moves the version to `dead_lettered` with the error persisted and
logged to `processing_events`. There is no separate dead-letter queue
resource locally — the status field is the dead-letter signal.

## Consequences
- Everything above is single-process and single-machine. It will not scale
  past local-dev/demo load, which is expected and fine for this phase.
- The heading/section heuristic needs validation against real call
  reports before Phase 3 chunking trusts section boundaries too heavily.
- Chunking, embeddings, and indexing are explicitly deferred to Phase 3 —
  Phase 2's `manifest.json` includes a `chunking: {"strategy":
  "not_started"}` placeholder so that boundary is visible in the data, not
  just in this document.
