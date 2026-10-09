import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Next.js 16 `proxy` (formerly `middleware`, which is deprecated in this
 * version -- see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md). Runs before every page render.
 *
 * 1. Per-request nonce Content-Security-Policy (blocks injected scripts).
 * 2. Security headers.
 * 3. Route gating by authentication and role. The FastAPI backend enforces
 *    the same rules on every API call -- this layer is for UX (redirect
 *    instead of an error page), not the security boundary.
 */

// Role required for each route prefix (ranked: customer < analyst < admin < super_admin).
const ROLE_RANK: Record<string, number> = { customer: 0, analyst: 1, admin: 2, super_admin: 3 };
const ROUTE_MIN_ROLE: Array<[string, string]> = [
  ["/admin", "super_admin"],
  ["/learning", "super_admin"],
  ["/observability", "admin"],
  ["/graph", "customer"],
  ["/decision-eval", "customer"],
  ["/evaluation", "customer"],
  ["/documents", "customer"],
];
const PUBLIC_AUTH_PAGES = new Set(["/login", "/signup", "/verify-phone"]);

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const apiOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").origin;
    } catch {
      return "";
    }
  })();
  const turnstile = "https://challenges.cloudflare.com";
  return [
    "default-src 'self'",
    // 'strict-dynamic': only nonce-bearing scripts (and scripts they load,
    // e.g. the Turnstile loader) may run. Injected <script> tags can't.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstile}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${turnstile}${isDev ? " ws: wss:" : ""}`,
    `frame-src 'self' blob: ${turnstile}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    // Only when the API itself is served over https -- otherwise this would
    // rewrite every http API call (e.g. docker-compose on localhost) to https.
    ...(!isDev && apiOrigin.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function withSecurityHeaders(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const pass = () => withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  const redirect = (url: URL) => withSecurityHeaders(NextResponse.redirect(url), csp);

  // Auth.js endpoints and the auth pages themselves are always reachable.
  if (pathname.startsWith("/api/auth") || PUBLIC_AUTH_PAGES.has(pathname)) {
    return pass();
  }

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  const isAuthenticated = !!token;
  const role = (token?.role as string) || "guest";
  const isPhoneVerified = (token?.phoneVerified as boolean) ?? false;

  // Signed in but phone not yet verified -> finish verification first.
  if (isAuthenticated && !isPhoneVerified) {
    return redirect(new URL("/verify-phone", req.url));
  }

  const rule = ROUTE_MIN_ROLE.find(([prefix]) => matchesPrefix(pathname, prefix));
  if (rule) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return redirect(loginUrl);
    }
    if ((ROLE_RANK[role] ?? -1) < ROLE_RANK[rule[1]]) {
      const forbiddenUrl = new URL("/copilot", req.url);
      forbiddenUrl.searchParams.set("error", "insufficient_permissions");
      return redirect(forbiddenUrl);
    }
  }

  // Guest access to '/', '/copilot' and '/search' is intentional (the UI
  // asks visitors to sign in before any data request; the API refuses
  // unauthenticated data calls regardless).
  return pass();
}

export const config = {
  matcher: [
    /*
     * Everything except Next's static output and public static assets.
     * (The old check skipped auth for ANY path containing a ".", so e.g.
     * "/admin/x.json" bypassed the role check entirely.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
