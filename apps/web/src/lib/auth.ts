/**
 * Browser-side source of the bearer token for the FastAPI backend.
 *
 * The token comes from this app's own `/api/auth/api-token` route, which
 * mints it from the signed-in user's httpOnly session cookie (per-user
 * identity, tenant and role, re-checked against the database). Signed-out
 * visitors get no token at all, so the API answers 401 -- previously every
 * visitor silently received a shared all-access `tenant-a` token from the
 * API's open `/auth/dev-token` endpoint.
 *
 * Tokens are cached in memory only (never localStorage, where any XSS
 * could read them) and refreshed 60s before expiry. Concurrent callers
 * share a single in-flight request.
 */

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken | null> | null = null;

async function fetchToken(): Promise<CachedToken | null> {
  const res = await fetch("/api/auth/api-token", { cache: "no-store", credentials: "same-origin" });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Failed to obtain an API token (${res.status})`);
  const data = (await res.json()) as { token: string; expiresIn: number };
  return { token: data.token, expiresAt: Date.now() + data.expiresIn * 1000 };
}

/** Drop the cached token (call on sign-in, sign-out and role switch). */
export function clearAuthToken(): void {
  cached = null;
  inflight = null;
}

/** Thrown instead of sending a request that can only fail with 401. */
export class AuthRequiredError extends Error {
  constructor() {
    super("Please sign in to load this data.");
    this.name = "AuthRequiredError";
  }
}

export function isAuthRequiredError(err: unknown): boolean {
  return err instanceof Error && err.name === "AuthRequiredError";
}

/** Returns `{ Authorization: "Bearer <token>" }` for a signed-in user.
 * Every caller is a protected API endpoint, so for a visitor this throws
 * AuthRequiredError rather than issuing a request that can only get 401. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") throw new AuthRequiredError();
  const now = Date.now();
  if (cached && cached.expiresAt - now > 60_000) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  if (!inflight) {
    inflight = fetchToken()
      .then((t) => {
        cached = t;
        return t;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const token = await inflight;
  if (!token) throw new AuthRequiredError();
  return { Authorization: `Bearer ${token.token}` };
}
