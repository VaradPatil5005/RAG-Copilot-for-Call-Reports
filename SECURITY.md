# Tathyx AI — Enterprise Security & Compliance Architecture

This document defines the security policies, authentication mechanisms, cryptographic standards, and access control models implemented across **Tathyx AI: Enterprise Decision Intelligence Copilot for Call Reports**.

---

## 1. Threat Model & Data Classification

Tathyx AI processes corporate call reports, quarterly commercial credit reviews, borrower debt trajectories, and financial covenant filings. Because this information is strictly confidential and market-sensitive:
- **No unauthenticated user** may execute custom copilot queries or upload new documents into organization vaults.
- **Tenant Partitioning**: All document embeddings, summaries, and persistent memories are strictly isolated by `orgId` / `tenant_id`. Cross-tenant data leakage is prevented cryptographically and at the database query layer.
- **Role Isolation**: Internal model telemetry, benchmark evaluation diagnostics, and platform administration are hidden from customer-facing roles.

---

## 2. Authentication & Credential Security

### 2.1 Password Storage (Argon2id)
All user passwords are encrypted using **Argon2id**, the winner of the Password Hashing Competition (PHC) and the industry gold standard against GPU/ASIC cracking:
- **Algorithm**: Argon2id
- **Memory Cost**: 65,536 KiB (64 MB)
- **Time Cost**: 3 iterations
- **Parallelism**: 4 execution threads

Plaintext passwords are never logged, never cached in memory, and never transmitted across unencrypted boundaries.

### 2.2 Institutional Password Policy
Passwords must satisfy the following minimum requirements during registration:
- Minimum length: **12 characters**
- At least one uppercase letter (`[A-Z]`)
- At least one lowercase letter (`[a-z]`)
- At least one numeric digit (`[0-9]`)
- At least one special character (`[!@#$%^&*...]`)

A real-time visual strength evaluator provides immediate feedback during account setup.

### 2.3 Brute-Force & Credential Stuffing Defense
- **Account Lockout**: 5 consecutive failed login attempts trigger an immediate **15-minute account freeze** (`lockedUntil`).
- **Sliding-Window Rate Limiting**: Max 5 login attempts per 15 minutes per email/IP; max 5 registrations per hour per IP.
- **Timing Attack Resistance**: Password verification and token comparisons employ `crypto.timingSafeEqual()` to eliminate side-channel timing attacks.

---

## 3. Two-Factor Authentication & Mobile Verification (OTP)

During onboarding and high-privilege administrative access, mobile verification is mandatory:
- **Entropy**: Cryptographically secure 6-digit numeric codes generated via `crypto.randomInt()`.
- **At-Rest Protection**: Plaintext OTPs are **never stored** in the database. Only one-way **SHA-256 hashes** are persisted.
- **Lifecycle & Throttling**:
  - Expiration TTL: **5 minutes**.
  - Attempt Capping: Maximum **5 verification attempts** before the OTP code is permanently invalidated.
  - Dispatch Capping: Maximum **3 requests per 15 minutes** per phone number.
  - UI Cooldown: 45-second timer on resend actions.
- **Smart Dev Mode**: For local sandbox testing without paid SMS fees (`OTP_DEV_MODE=true`), generated OTPs are logged directly to the secure terminal console and exposed in an interactive dev toast banner.

---

## 4. Role-Based Access Control (RBAC) Matrix

Tathyx AI enforces a 4-tier Role-Based Access Control hierarchy:

| Surface / Capability | `guest` | `customer` | `analyst` | `admin` | `super_admin` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Overview Dashboard (Discovery)** |  View Only |  |  |  |  |
| **Copilot Chat (Personalized RAG)** | 🔒 Action-Gated |  Org-Scoped |  |  |  |
| **Document Ingestion & Vault** | 🔒 Action-Gated |  Org-Scoped |  |  |  |
| **Hybrid Search (Lexical + Dense)** | 🔒 Action-Gated |  Org-Scoped |  |  |  |
| **Knowledge Graph (Entity Traversal)** | ❌ Hidden | ❌ Hidden |  |  |  |
| **Decision Intelligence (Covenants)** | ❌ Hidden | ❌ Hidden |  Multi-Org |  |  |
| **Self-Learning & Adaptive Memory** | ❌ Hidden | ❌ Hidden | ❌ Hidden |  |  |
| **Benchmark Evaluation (MRR/Hit Rate)**| ❌ Hidden | ❌ Hidden | ❌ Hidden |  |  |
| **System Diagnostics & Cost Telemetry** | ❌ Hidden | ❌ Hidden | ❌ Hidden |  |  |
| **Zero-G Runtime Latency HUD** | ❌ Hidden | ❌ Hidden |  |  |  |
| **Organization User Management** | ❌ Hidden | ❌ Hidden | ❌ Hidden |  Org Only |  |
| **Global Platform Admin & Cross-Org** | ❌ Hidden | ❌ Hidden | ❌ Hidden | ❌ Hidden |  Global |
| **Audit Logs Access** | ❌ None | ❌ None | ❌ None |  Org Only |  Global |

---

## 5. Session Security & Transport Controls

- **Cookie Transport**: Session tokens are transported via `httpOnly`, `Secure`, `SameSite=Lax` cookies to prevent Cross-Site Scripting (XSS) extraction.
- **Persistence Toggle ("Remember Me")**: Users can toggle between a persistent 30-day session and a short-lived browser session.
- **HTTP Security Headers** (enforced by `middleware.ts` on all responses):
  - `X-Frame-Options: DENY` (prevents clickjacking attacks)
  - `X-Content-Type-Options: nosniff` (prevents MIME-type sniffing)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (enforces HSTS)
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 6. Backend Cryptographic Bridge (FastAPI Harmony)

When the Next.js frontend calls the FastAPI backend (`apps/api` on port 8000), requests present an **HS256 Bearer JWT** signed with the shared `AUTH_SECRET`:
- **Claims**:
  - `sub`: User ID
  - `tenant_id`: Organization ID
  - `principals`: `[role, f"org:{orgId}", email]`
  - `role`: `customer` | `analyst` | `admin` | `super_admin`
- The backend FastAPI dependency (`require_identity`) verifies this signature before fulfilling any data query, ensuring that client-side parameters can never forge an elevated identity.

---

## 7. Audit Logging & Compliance (DPDP Act & GDPR Ready)

Every privileged and stateful action writes an immutable record to the `AuditLog` table:
- Actions tracked: `login_success`, `login_failed`, `account_locked`, `signup_started`, `phone_verified`, `role_changed`, `document_uploaded`, `query_executed`, `data_exported`.
- Captured context: Actor ID, action type, IP address, user-agent, timestamp, and sanitized metadata.
- Data Minimization: All authentication secrets, plaintext passwords, tokens, and OTP codes are strictly stripped prior to persistence.
- Erasure & Export: Users have the institutional right to request account deletion and export of all associated audit trails.
