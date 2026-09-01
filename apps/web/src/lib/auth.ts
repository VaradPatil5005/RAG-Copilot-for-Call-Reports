/**
 * Phase 6.3: the API now requires a verified bearer token on every
 * protected request (POST /documents/upload, GET/PATCH /documents/*,
 * /search, /retrieval, /chat, /graph/query) -- it no longer accepts a
 * client-supplied `principals`/`tenant_id` field, per ADR 0007.
 *
 * This is the browser-side half of that: a real login flow (the
 * enterprise IdP, in a production deployment) would hand this app a
 * token; this local-dev stand-in instead calls the API's own
 * `/auth/dev-token` endpoint (gated server-side by `AUTH_DEV_MODE`) to
 * get one, caches it in memory, and refreshes it before it expires.
 * Everything else in this app only calls `getAuthHeaders()` and doesn't
 * know or care which flow produced the token.
 */
const AUTH_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// Local-dev-only identity for the whole web UI session -- a real
// deployment replaces this with whatever identity the enterprise IdP
// authenticated, per-user, at login.
const DEV_IDENTITY = {
  sub: "web-ui",
  tenant_id: "tenant-a",
  principals: ["tenant:tenant-a"],
};

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

async function fetchToken(): Promise<CachedToken> {
  const res = await fetch(`${AUTH_API_BASE}/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(DEV_IDENTITY),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      `Failed to obtain a dev auth token (${res.status}): ${text}. ` +
        `Is AUTH_DEV_MODE enabled on the API? (see app/config.py)`
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

/** Returns `{ Authorization: "Bearer <token>" }`, minting or refreshing
 * the cached token as needed. Refreshes 30s before actual expiry so a
 * slow request never races an expiring token. Concurrent callers during
 * the first mint share a single in-flight request rather than each
 * minting their own token. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cached && cached.expiresAt - now > 30_000) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  if (!inflight) {
    inflight = fetchToken()
      .then((t) => {
        cached = t;
        return t.token;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const token = await inflight;
  return { Authorization: `Bearer ${token}` };
}
