import { getCsrfToken } from "next-auth/react";

/**
 * Asks Auth.js to re-issue the session cookie. This is the same request
 * `useSession().update()` makes (POST /api/auth/session with a CSRF
 * token); the `jwt` callback in src/auth.ts then re-reads role, org and
 * phone-verification status from the database. Nothing in `data` is
 * trusted -- it's intentionally empty.
 */
export async function refreshSessionClaims(): Promise<boolean> {
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return false;
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csrfToken, data: {} }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Dev-mode OTP hand-off between the sign-up and verify pages. Kept in
 * sessionStorage (tab-scoped) instead of the URL, where it would land in
 * browser history, analytics and server access logs. */
export const DEV_OTP_STORAGE_KEY = "tathyx-dev-otp";
