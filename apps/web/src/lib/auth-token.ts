import { SignJWT, jwtVerify } from "jose";

const INSECURE_DEFAULT_SECRET = "local-dev-insecure-secret-do-not-use-in-production";
// Must match AUTH_AUDIENCE in apps/api/app/config.py.
export const API_TOKEN_AUDIENCE = process.env.AUTH_AUDIENCE || "tathyx-api";
// Short-lived on purpose: the browser re-fetches one from /api/auth/api-token,
// which re-checks the user's current role/status in the database each time.
export const API_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Returns the shared HS256 secret (also used by NextAuth and the FastAPI
 * backend). Refuses to run in production with the public default value --
 * anyone who has read this repository could otherwise forge tokens.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret === INSECURE_DEFAULT_SECRET || secret.length < 32) {
      throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters in production");
    }
    return secret;
  }
  return secret || INSECURE_DEFAULT_SECRET;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getAuthSecret());
}

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
  ttlSeconds: number = API_TOKEN_TTL_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenant_id: payload.tenant_id,
    principals: payload.principals,
    role: payload.role,
    email: payload.email,
    name: payload.name,
    phoneVerified: payload.phoneVerified ?? false,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setAudience(API_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey());
}

/**
 * Verifies an HS256 JWT issued for the frontend or backend
 */
export async function verifyApiToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      audience: API_TOKEN_AUDIENCE,
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
