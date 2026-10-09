/**
 * Server-side CAPTCHA verification (Cloudflare Turnstile).
 *
 * The browser widget only produces a token; it proves nothing until this
 * function redeems it with Cloudflare using the *secret* key. Tokens are
 * single-use and expire after 5 minutes, so a solved CAPTCHA cannot be
 * replayed by a bot farm.
 *
 * Configuration:
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (public, rendered in the widget)
 *   TURNSTILE_SECRET_KEY            (server only, never sent to the client)
 *
 * Outside production, if no keys are configured, Cloudflare's documented
 * always-pass *test* keys are used so local development keeps working.
 * In production a missing secret fails closed: every login/sign-up is
 * refused rather than silently running without a CAPTCHA.
 *
 * Server-side only: imported from route handlers and src/auth.ts, never
 * from a "use client" module (the secret must not reach the bundle).
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Cloudflare-published test secret: always passes, only for non-production.
const DEV_TEST_SECRET = "1x0000000000000000000000000000000AA";

export interface CaptchaResult {
  ok: boolean;
  reason?: string;
}

function resolveSecret(): string | null {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") return null;
  return DEV_TEST_SECRET;
}

export async function verifyCaptcha(token: unknown, remoteIp?: string): Promise<CaptchaResult> {
  const secret = resolveSecret();
  if (!secret) {
    console.error("[captcha] TURNSTILE_SECRET_KEY is not set in production -- refusing request");
    return { ok: false, reason: "captcha_not_configured" };
  }
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, reason: "captcha_missing" };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp && remoteIp !== "untrusted-client") form.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `captcha_http_${res.status}` };
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) return { ok: true };
    return { ok: false, reason: (data["error-codes"] || []).join(",") || "captcha_failed" };
  } catch (error) {
    console.error("[captcha] verification request failed:", error);
    return { ok: false, reason: "captcha_unreachable" };
  }
}

export const CAPTCHA_ERROR_MESSAGE = "Security check failed. Please complete the CAPTCHA and try again.";
