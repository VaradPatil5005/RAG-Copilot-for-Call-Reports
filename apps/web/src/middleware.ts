import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Routes that require specific elevated roles
const SUPER_ADMIN_ROUTES = ["/admin", "/learning"];
// Intelligence routes requiring authentication (open to all authenticated users)
const PROTECTED_INTELLIGENCE_ROUTES = [
  "/graph",
  "/decision-eval",
  "/evaluation",
  "/observability",
  "/documents",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Inbound Security Headers applied to every response
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Skip static assets, next internal files, and public auth endpoints
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.includes(".") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/verify-phone"
  ) {
    return response;
  }

  // Retrieve decrypted NextAuth JWT token
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET || "local-dev-insecure-secret-do-not-use-in-production",
  });

  const role = (token?.role as string) || "guest";
  const isAuthenticated = !!token;
  const isPhoneVerified = (token?.phoneVerified as boolean) ?? false;

  // If user is authenticated but hasn't verified their phone, force /verify-phone
  if (isAuthenticated && !isPhoneVerified && pathname !== "/verify-phone") {
    const verifyUrl = new URL("/verify-phone", req.url);
    return NextResponse.redirect(verifyUrl);
  }

  // 2. Super Admin Only Route Enforcement (Platform Hub & Self-Learning Core)
  const isSuperAdminRoute = SUPER_ADMIN_ROUTES.some((r) => pathname.startsWith(r));
  if (isSuperAdminRoute) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (role !== "super_admin") {
      const forbiddenUrl = new URL("/copilot", req.url);
      forbiddenUrl.searchParams.set("error", "insufficient_permissions");
      return NextResponse.redirect(forbiddenUrl);
    }
  }

  // 3. Authenticated Intelligence Routes (Open to all authenticated users)
  const isProtectedIntelligenceRoute = PROTECTED_INTELLIGENCE_ROUTES.some((r) =>
    pathname.startsWith(r)
  );
  if (isProtectedIntelligenceRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Note: Guest access to '/' (Overview) is explicitly preserved for the Perplexity-style discovery experience.
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
