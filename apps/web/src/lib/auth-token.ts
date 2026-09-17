import { SignJWT, jwtVerify } from "jose";

const AUTH_SECRET = process.env.AUTH_SECRET || "local-dev-insecure-secret-do-not-use-in-production";
const secretKey = new TextEncoder().encode(AUTH_SECRET);

export interface TokenPayload {
  sub: string;
  tenant_id: string;
  principals: string[];
  role: string;
  email?: string;
  name?: string;
  phoneVerified?: boolean;
}

/**
 * Mints an HS256 JWT compatible with FastAPI apps/api/app/services/auth.py
 */
export async function mintApiToken(
  payload: TokenPayload,
  ttlSeconds: number = 3600 * 24 * 30 // 30 days
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: payload.sub,
    tenant_id: payload.tenant_id,
    principals: payload.principals,
    role: payload.role,
    email: payload.email,
    name: payload.name,
    phoneVerified: payload.phoneVerified ?? false,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey);
}

/**
 * Verifies an HS256 JWT issued for the frontend or backend
 */
export async function verifyApiToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    return {
      sub: payload.sub as string,
      tenant_id: (payload.tenant_id as string) || "tenant-a",
      principals: (payload.principals as string[]) || [],
      role: (payload.role as string) || "customer",
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      phoneVerified: (payload.phoneVerified as boolean) ?? false,
    };
  } catch {
    return null;
  }
}
