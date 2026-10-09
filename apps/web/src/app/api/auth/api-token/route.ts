import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { API_TOKEN_TTL_SECONDS, mintApiToken } from "@/lib/auth-token";

/**
 * Exchanges the signed-in user's httpOnly session cookie for a short-lived
 * bearer token for the FastAPI backend.
 *
 * Why this exists instead of putting a token in the session: the old flow
 * either (a) had every browser -- including logged-out visitors -- mint a
 * shared all-access token from the API's open /auth/dev-token endpoint, or
 * (b) embedded a 30-day token in the session JSON. Here the identity,
 * tenant and role are re-read from the database on every mint, so a
 * suspended user or a demoted admin loses API access within one token
 * lifetime (15 minutes), and a stolen token is only useful briefly.
 */
export async function GET() {
  const noStore = { "Cache-Control": "no-store" };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: noStore });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "active" || !user.phoneVerified || !user.orgId) {
    return NextResponse.json({ error: "account_not_active" }, { status: 403, headers: noStore });
  }

  const token = await mintApiToken({
    sub: user.id,
    // Each organisation is an isolated tenant in the backend.
    tenant_id: user.orgId,
    principals: [`tenant:${user.orgId}`, `user:${user.id}`],
    role: user.role,
    email: user.email,
    name: user.name || undefined,
    phoneVerified: user.phoneVerified,
  });

  return NextResponse.json({ token, expiresIn: API_TOKEN_TTL_SECONDS }, { headers: noStore });
}
