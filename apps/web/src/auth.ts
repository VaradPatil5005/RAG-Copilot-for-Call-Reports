import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { randomBytes } from "crypto";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limiter";
import { verifyCaptcha } from "@/lib/captcha";
import { getClientIp } from "@/lib/client-ip";

/**
 * Sign-in failures are reported to the client as a `code` (next-auth v5
 * only forwards `CredentialsSignin.code`; a plain thrown Error surfaces as
 * a generic "Configuration" error). Codes are deliberately coarse: a wrong
 * password and an unknown email both produce "invalid", so the login form
 * can't be used to discover which emails have accounts.
 */
class SignInFailure extends CredentialsSignin {
  constructor(code: "captcha" | "rate_limited" | "invalid" | "locked" | "inactive") {
    super();
    this.code = code;
  }
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// How often the session JWT re-reads role/status from the database, so a
// suspension, role change or phone verification takes effect without the
// user having to sign out.
const SESSION_REVALIDATE_SECONDS = 5 * 60;

// A real argon2id hash (same parameters as user hashes) of random bytes,
// verified against for unknown emails so they take as long as known ones
// (prevents timing-based discovery of which emails have accounts).
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHashPromise;
}

async function loadUserClaims(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { org: true } });
  if (!user) return null;
  return {
    role: user.role,
    orgId: user.orgId,
    orgName: user.org?.name || null,
    phoneVerified: user.phoneVerified,
    status: user.status,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days (was 30); claims are re-validated every 5 min
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    Credentials({
      name: "Institutional Credentials",
      credentials: {
        email: { label: "Work Email", type: "email" },
        password: { label: "Password", type: "password" },
        rememberMe: { label: "Remember Me", type: "text" },
        captchaToken: { label: "CAPTCHA", type: "text" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email.toLowerCase().trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password || email.length > 254 || password.length > 256) {
          throw new SignInFailure("invalid");
        }

        const ip = getClientIp(request.headers);
        const userAgent = request.headers.get("user-agent") || undefined;

        // 1. Throttle before doing any expensive work. Per-IP stops
        //    credential stuffing across many emails; per-email stops a
        //    distributed guess against one account.
        const ipLimit = checkRateLimit(`login-ip:${ip}`, 30, 15 * 60);
        const emailLimit = checkRateLimit(`login:${email}`, 10, 15 * 60);
        if (!ipLimit.success || !emailLimit.success) {
          await logAudit({ action: "login_failed", ip, userAgent, metadata: { email, reason: "rate_limited" } });
          throw new SignInFailure("rate_limited");
        }

        // 2. CAPTCHA (server-side redemption of the widget token).
        const captcha = await verifyCaptcha(credentials?.captchaToken, ip);
        if (!captcha.ok) {
          await logAudit({
            action: "login_failed",
            ip,
            userAgent,
            metadata: { email, reason: "captcha", detail: captcha.reason },
          });
          throw new SignInFailure("captcha");
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { org: true },
        });

        if (!user || !user.passwordHash) {
          await verifyPassword(await getDummyHash(), password); // equalize timing
          await logAudit({ action: "login_failed", ip, userAgent, metadata: { email, reason: "user_not_found" } });
          throw new SignInFailure("invalid");
        }

        // Account lockout check
        if (user.lockedUntil && new Date() < user.lockedUntil) {
          await logAudit({
            userId: user.id,
            action: "login_failed",
            ip,
            userAgent,
            metadata: { email, reason: "account_locked" },
          });
          throw new SignInFailure("locked");
        }

        const isValid = await verifyPassword(user.passwordHash, password);

        if (!isValid) {
          // Atomic increment: parallel guesses can't each read the same
          // stale counter and slip past the lockout threshold.
          const updated = await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
          });
          const shouldLock = updated.failedLoginCount >= MAX_FAILED_ATTEMPTS;
          if (shouldLock) {
            await prisma.user.update({
              where: { id: user.id },
              data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000), failedLoginCount: 0 },
            });
          }

          await logAudit({
            userId: user.id,
            action: shouldLock ? "account_locked" : "login_failed",
            ip,
            userAgent,
            metadata: { email, failedAttempts: updated.failedLoginCount },
          });
          throw new SignInFailure(shouldLock ? "locked" : "invalid");
        }

        if (user.status === "suspended" || user.status === "disabled") {
          await logAudit({ userId: user.id, action: "login_failed", ip, userAgent, metadata: { email, reason: user.status } });
          throw new SignInFailure("inactive");
        }

        // Reset failed login counter and record login timestamp
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
          },
        });

        await logAudit({
          userId: user.id,
          action: "login_success",
          ip,
          userAgent,
          metadata: { email, role: user.role, org: user.org?.name },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Google sign-in: link to (or create) a local user record so the
     * account gets its own organisation/tenant, role and phone
     * verification like every credentials user. Without this, every
     * Google user previously shared one default tenant.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const email = user.email?.toLowerCase().trim();
      if (!email || (profile as { email_verified?: boolean } | undefined)?.email_verified !== true) {
        return false;
      }
      let dbUser = await prisma.user.findUnique({ where: { email } });
      if (!dbUser) {
        const org = await prisma.organization.create({
          data: { name: `${user.name || email.split("@")[0]}'s Workspace`, plan: "standard" },
        });
        dbUser = await prisma.user.create({
          data: {
            email,
            name: user.name,
            image: user.image,
            emailVerified: new Date(),
            role: "customer",
            status: "pending_verification",
            orgId: org.id,
          },
        });
        await logAudit({ userId: dbUser.id, action: "signup_started", metadata: { email, provider: "google" } });
      }
      if (dbUser.status === "suspended" || dbUser.status === "disabled") return false;
      user.id = dbUser.id;
      return true;
    },

    async jwt({ token, user, trigger }) {
      const now = Math.floor(Date.now() / 1000);
      if (user?.id) {
        token.id = user.id;
      }
      // Role, org and verification status always come from the database --
      // never from the client. (Previously `session.update({ role })` from
      // the browser was copied straight into the token: any user could make
      // themselves super_admin.)
      const lastChecked = (token.claimsCheckedAt as number | undefined) ?? 0;
      if (token.id && (user || trigger === "update" || now - lastChecked > SESSION_REVALIDATE_SECONDS)) {
        const claims = await loadUserClaims(token.id as string);
        if (!claims || claims.status === "suspended" || claims.status === "disabled") {
          return null; // ends the session
        }
        token.role = claims.role;
        token.orgId = claims.orgId;
        token.orgName = claims.orgName;
        token.phoneVerified = claims.phoneVerified;
        token.status = claims.status;
        token.claimsCheckedAt = now;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as typeof session.user & {
          role: string;
          orgId?: string;
          orgName?: string;
          phoneVerified: boolean;
          status?: string;
        };
        u.id = token.id as string;
        u.role = (token.role as string) || "customer";
        u.orgId = token.orgId as string | undefined;
        u.orgName = token.orgName as string | undefined;
        u.phoneVerified = (token.phoneVerified as boolean) ?? false;
        u.status = token.status as string | undefined;
      }
      return session;
    },
  },
});
