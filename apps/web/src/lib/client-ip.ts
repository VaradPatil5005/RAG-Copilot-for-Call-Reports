/**
 * Resolves the caller's IP for rate limiting and audit logs.
 *
 * `X-Forwarded-For` is trivially spoofable by the client unless a reverse
 * proxy you control overwrites it, so it is only trusted when
 * TRUST_PROXY_HEADERS=true (set this when deployed behind Vercel, a load
 * balancer, Cloudflare, nginx, ...). Otherwise every request falls into a
 * single shared bucket -- rate limits stay enforced (just coarser) instead
 * of being bypassable by sending a fresh fake IP on every request.
 */
export function getClientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const cf = headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const real = headers.get("x-real-ip");
    if (real) return real.trim();
    const fwd = headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
  }
  return "untrusted-client";
}
