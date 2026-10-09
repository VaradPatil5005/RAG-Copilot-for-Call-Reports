# Security hardening, Word support & scaling notes

Threat model: an attacker who has read this public repository, can script HTTP
requests at scale, can use an AI agent to automate attacks, and can sign up
for a normal account. Every item below was fixed and checked against that
attacker. The "Evidence" column names the test or live check that shows it.

## Vulnerabilities found and fixed

| # | Severity | Finding (before) | Fix | Evidence |
|---|----------|------------------|-----|----------|
| 1 | Critical | `POST /auth/dev-token` was **on by default** (`AUTH_DEV_MODE` defaulted to true, and docker-compose forced it on). Anyone could mint a token for any tenant/role and read every report. | Defaults to off. API refuses to start with dev mode in production. Token carries a validated `role`. | Live probe returns 404; `test_auth_dev_mode_is_off_by_default_and_insecure_secret_refused` |
| 2 | Critical | Every browser, **including signed-out visitors**, used one shared all-access `tenant-a` token (`lib/auth.ts`). Users weren't isolated from each other and guests could read data. | New `/api/auth/api-token` mints a 15-min **per-user** token from the httpOnly session, re-reading role/org/status from the DB. Each organisation is its own tenant. Guests get no token. | Browser check: analyst token = own org + `analyst`; a user in another org sees 0 docs, 404 on direct ID/file, 0 search hits |
| 3 | Critical | The JWT and API used the **public default secret** whenever `AUTH_SECRET` was unset, so anyone could forge tokens. | API refuses to start without a ≥32-char non-default secret unless dev mode is on. Web refuses to mint in production. Tokens now need `aud` and `exp`, and `alg` is pinned to HS256. | Live probe: forged-with-default token → 401, `alg=none` → 401; `test_token_without_audience_is_rejected` |
| 4 | Critical | **Privilege escalation:** the `jwt` callback copied `role`/`phoneVerified` from the client's `session.update()` payload, so any user could make themselves `super_admin`. | Claims always come from the DB (on sign-in, on update, and every 5 min). A suspended user's session is ended. | Browser: customer posts `{role:"super_admin"}` → role stays `customer`, admin API 403 |
| 5 | Critical | Unauthenticated endpoints leaked data across tenants: `/system/insights` (report **content**), `/chat/traces` (everyone's questions & answers), `/system/audit` (principals incl. emails), `/system/admin/*`, `/observability/*`. | All require auth. Insights, metrics and traces are tenant-scoped. Non-admins only see their own traces. Audit is limited to admins, and own tenant only unless super admin. | `test_previously_public_endpoints_now_require_auth`, `test_insights_never_leak_another_tenants_documents` |
| 6 | Critical | Destructive ops were unauthenticated: DR drill, `/search/reindex`, `/search/rollback`, evaluation runs, synthetic-corpus generation. | Super-admin only. | `test_customer_role_cannot_reach_admin_endpoints` |
| 7 | High | Login page and modal **published the super-admin password** as one-click buttons. | Shown only with `NEXT_PUBLIC_ENABLE_DEMO_LOGINS=true` and never in production. Seed refuses to run in production. | Prod build: demo buttons absent |
| 8 | High | **OTP bypass:** dev mode switched on automatically when Twilio keys were missing, so the OTP for *any* phone came back in the HTTP response. | Dev mode needs explicit `OTP_DEV_MODE=true` and is impossible in production. Without SMS it fails closed. | code: `lib/otp.ts:isOtpDevMode` |
| 9 | High | OTP brute force: the attempt check was read-then-increment (unlimited parallel guesses), and codes were stored as unsalted SHA-256 (900k values, reversible). | Attempt is reserved atomically before comparing. Codes are consumed exactly once. HMAC keyed with the server secret. | code review: `verifyOtp` |
| 10 | High | No CAPTCHA, so login, sign-up and SMS sending were open to bots. Anyone could trigger SMS to any number (toll fraud / harassment). | Cloudflare Turnstile is verified **server-side** on login, sign-up, resend-OTP and the post-OTP auto-login. Single-use tokens. Fails closed in production. Resend only sends to accounts awaiting verification. | Browser: button disabled until solved; prod without keys shows "CAPTCHA is not configured" |
| 11 | High | Logout never worked: a bare POST without the CSRF token left the session cookie in place. | Uses `signOut()`. | Browser: old call → still signed in; fixed UI logout → signed out, token 401 |
| 12 | High | Proxy auth bypass: any path containing `.` skipped auth (`/admin/x.json`). | Matcher excludes only real static assets. | `src/proxy.ts` |
| 13 | High | **Path traversal (Windows):** `/documents/{id}/figures/{filename}` joined an attacker-controlled name, so `..\..\` could reach other tenants' files. | Allow-listed name plus a resolved-path containment check. | `test_figure_path_traversal_is_blocked` |
| 14 | High | **ACL drift:** editing a document's classification/owner/customer didn't update chunk or graph ACLs. A report reclassified to confidential stayed visible tenant-wide. | ACL-relevant edits re-queue the document to rebuild ACLs. Values are validated. | code: `routers/documents.py:update_document_metadata` |
| 15 | Medium | IDOR: `DELETE /learning/memories/user/{id}` let any user in the tenant delete others' memories. Customers could write tenant-wide memories/skills that are injected into everyone's prompts. | Delete is scoped to the owner. Tenant-wide writes are admin-only. | `test_user_cannot_delete_another_users_memory` |
| 16 | Medium | No rate limiting on the API. Login was limited per email only (credential stuffing across emails). `X-Forwarded-For` was trusted blindly (spoofable). | Per-IP API limits, plus tighter limits on uploads and expensive endpoints. Login limited per IP and per email. Proxy headers trusted only when `TRUST_PROXY_HEADERS=true`. | Live: 130-request burst → 429s |
| 17 | Medium | No security headers or CSP on the API. Web had no CSP. `/docs` was public. Unbounded request bodies. | Nonce-based CSP (`strict-dynamic`, no `unsafe-eval` in prod), HSTS, nosniff, frame-deny, `no-store`. Body-size cap (413). Docs off in production. | Live header checks; `test_oversized_body_rejected_before_read` |
| 18 | Medium | Lockout messages never reached users (v5 turns thrown errors into "Configuration"). Lockout counter raced. Unknown emails answered faster than known ones (enumeration). | `CredentialsSignin` codes, atomic increment, dummy-hash timing equalisation, generic "Invalid email or password". | Browser: wrong password → generic message |
| 19 | Medium | No `.dockerignore`, so `COPY . .` baked `apps/api/.env` (LLM API keys), `venv/` and the SQLite DB into images. | `.dockerignore` for both apps. Web container runs as non-root. | files |
| 20 | Medium | Document IDs used `random` (predictable). Collisions caused HTTP 500. | CSPRNG with a collision retry. | code |

### Other bugs fixed
- **Running the test suite deleted `apps/api/data/`** (the developer's real documents). Tests now use a throwaway temp dir, and the data dir is configurable via `TATHYX_DATA_DIR`.
- **Blue/green reindex and rollback lost documents.** Docs ingested during a rebuild, or since an older version was active, were in the DB but missing from vector search.
  - The index switch now serialises with indexing and reconciles against `chunks`.
  - `get_index_manager()` re-checks the active version instead of caching it forever.
  - Evidence: `test_rollback_keeps_documents_ingested_after_the_switch_searchable` fails without the fix and passes with it.
- Document figures never loaded: `<img src>` can't send the bearer token. They're now fetched with auth (`AuthedFigure`).
- Evaluation POSTs from the UI sent no token.
- The "Resend Code" countdown in the auth modal never decremented, so resend stayed disabled forever.
- Signed-in users who verified their phone were redirected back to `/verify-phone` (stale session). The session is now refreshed.
- `.env.example` documented `NEXT_PUBLIC_API_URL`, but the code reads `NEXT_PUBLIC_API_BASE`.
- The web Dockerfile never ran `prisma generate`.
- Tests that were silently not testing anything:
  - the two cross-tenant search-leak tests always got 422 (`top_k: 20` > max 15) and never exercised isolation;
  - the reindex test expected a removed field.

## Word document support
- Accepts `.pdf`, `.docx`, `.doc`. Type is detected by **content** (magic bytes plus container structure), never by extension alone.
- `.docx` is parsed with the standard library and rendered to PDF with PyMuPDF (no new dependency). Headings, tables, bold/italic, lists and Unicode (₹, —, é) are preserved. The original file is kept as `source.docx`.
- Hostile-input checks, all tested: zip bomb, XXE, billion laughs, UTF-16 DTD smuggling, macro-enabled docs renamed to `.docx`, `.exe`/PDF disguised as Word, empty or corrupt docs.
- Legacy `.doc` is converted only when LibreOffice (`soffice`) is installed. Otherwise the user is told to save it as `.docx`.
- The UI rejects any other file with "File cannot be accepted…" for exactly 3 seconds. Browser check: visible at 0.3 s and 2.8 s, gone at 3.4 s.

## Production checklist (required)
1. Generate one secret and set it identically for API and web:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"` → `AUTH_SECRET`.
2. Create Cloudflare Turnstile keys and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
3. Configure Twilio (`TWILIO_*`). Without it, sign-up verification is refused in production.
4. `APP_ENV=production`, `AUTH_DEV_MODE=false`, and `CORS_ALLOWED_ORIGINS=https://your-web-domain`.
5. Behind a proxy or CDN: `TRUST_PROXY_HEADERS=true` on both apps.
6. Serve both apps over HTTPS.
7. **Rotate the Gemini/Groq keys** in `apps/api/.env` if any image was ever built from this repo before the `.dockerignore` existed.

## Known remaining risks (not fixed here)
- Rate limits and the CAPTCHA/OTP throttles are in-process memory. They're correct for one instance, but multiple replicas each get their own budget. Move them to Redis or the edge (Cloudflare WAF) when scaling out.
- **Do not run multiple API workers or replicas yet.** Each process keeps its own in-memory HNSW index and persists it to the same file, so processes can miss or overwrite each other's vectors. The Dockerfile runs one uvicorn worker, which is safe. Scaling out requires the vector-DB move in the roadmap below.
- 36 ESLint errors remain. All are pre-existing patterns (`catch (err: any)`, setState-in-effect); none are in files created in this change. `tsc` passes.
- Backend suite: **205 passed, 6 failed**. Every one of the 6 also fails on the original code (HEAD plus your uncommitted changes) under the same conditions:
  - `test_phase6_admin`: your uncommitted change made `/run-full` default to the 317-query set, but the test expects 10.
  - 3× `test_phase6_graph` and `test_query_router`: graph extraction needs the LLM, and Groq returned 429 during the runs. The original and the hardened code flip between 1 and 3 failures identically.
  - `test_observability` cost test.
- No MFA for admins (TOTP/WebAuthn recommended for `admin`/`super_admin`). No password-reset flow.
- Prompt injection inside uploaded documents is mitigated by grounding and citation validation, not eliminated.

## Scaling roadmap (for discussion)
1. **State out of the process.**
   - SQLite becomes Postgres (Prisma already supports it; the API's `db.py` is the single swap point).
   - Local `data/` becomes object storage (S3/R2/Azure Blob), with signed URLs for the viewer.
   - hnswlib becomes a managed vector DB (pgvector, Qdrant, Azure AI Search) with per-tenant namespaces.
2. **Ingestion workers.** Replace the in-process `asyncio.Queue` with a durable queue (Redis/RQ, Celery, SQS or Service Bus) so uploads survive restarts and OCR/LLM work scales horizontally, separate from API pods.
3. **Shared limits and caches.** Use Redis for rate limits, OTP throttles, the token cache and embedding/answer caching. Use a cross-replica signal for index switches (already noted in `search_index.switch_active_index`).
4. **LLM cost and latency.**
   - Route by intent: a small model for extraction and a large one for synthesis.
   - Cache embeddings by content hash.
   - Set per-tenant token budgets (`chat_traces` already records real token counts).
   - Use provider failover instead of a single Groq key, which was rate-limited during testing.
5. **Multi-tenant SaaS.**
   - Org admin console: invite users, assign roles.
   - SSO/SAML for banks.
   - Per-tenant data residency and encryption keys (KMS).
   - Audit export.
   - Plans and usage metering.
6. **Observability.** OpenTelemetry traces across web → API → workers → LLM, SLOs on time-to-indexed and answer latency, and alerting on 401/403/429 spikes, which are the attack signals.
7. **Edge security.** Cloudflare/WAF in front of both apps, bot management, and per-route rate rules. Keep the app-level limits as defence in depth.
