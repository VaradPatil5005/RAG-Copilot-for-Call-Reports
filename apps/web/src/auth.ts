import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limiter";
import { mintApiToken } from "@/lib/auth-token";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
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
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        // Rate-limiting check per email: max 5 attempts per 15 min
        const rateLimit = checkRateLimit(`login:${email}`, 5, 15 * 60);
        if (!rateLimit.success) {
          throw new Error("Too many failed attempts. Please wait 15 minutes before trying again.");
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { org: true },
        });

        if (!user || !user.passwordHash) {
          await logAudit({
            action: "login_failed",
            metadata: { email, reason: "user_not_found" },
          });
          return null;
        }

        // Account lockout check
        if (user.lockedUntil && new Date() < user.lockedUntil) {
          const minutesRemaining = Math.ceil(
            (user.lockedUntil.getTime() - Date.now()) / 60000
          );
          await logAudit({
            userId: user.id,
            action: "login_failed",
            metadata: { email, reason: "account_locked", minutesRemaining },
          });
          throw new Error(
            `Account temporarily locked for security. Please try again in ${minutesRemaining} minute(s).`
          );
        }

        const isValid = await verifyPassword(user.passwordHash, password);

        if (!isValid) {
          const newFailedCount = user.failedLoginCount + 1;
          const lockTime =
            newFailedCount >= 5
              ? new Date(Date.now() + 15 * 60 * 1000) // lock 15 min
              : null;

          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: newFailedCount,
              lockedUntil: lockTime,
            },
          });

          await logAudit({
            userId: user.id,
            action: lockTime ? "account_locked" : "login_failed",
            metadata: { email, failedAttempts: newFailedCount },
          });

          return null;
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
          metadata: { email, role: user.role, org: user.org?.name },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          orgId: user.orgId,
          orgName: user.org?.name || "Tathyx Enterprise",
          phoneVerified: user.phoneVerified,
          status: user.status,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role || "customer";
        token.orgId = (user as any).orgId || "org-default";
        token.orgName = (user as any).orgName || "Tathyx Enterprise";
        token.phoneVerified = (user as any).phoneVerified ?? false;
        token.status = (user as any).status || "active";

        // Mint high-assurance JWT for FastAPI backend authorization
        token.apiToken = await mintApiToken({
          sub: user.id as string,
          tenant_id: ((user as any).orgId as string) || "tenant-a",
          principals: [
            (user as any).role || "customer",
            `org:${(user as any).orgId || "default"}`,
            user.email as string,
          ],
          role: (user as any).role || "customer",
          email: user.email as string,
          name: user.name as string,
          phoneVerified: (user as any).phoneVerified ?? false,
        });
      }

      // Handle client-side session refresh e.g. after phone verification
      if (trigger === "update" && session) {
        if (session.phoneVerified !== undefined) {
          token.phoneVerified = session.phoneVerified;
        }
        if (session.role !== undefined) {
          token.role = session.role;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role as string;
        (session.user as any).orgId = token.orgId as string;
        (session.user as any).orgName = token.orgName as string;
        (session.user as any).phoneVerified = token.phoneVerified as boolean;
        (session.user as any).status = token.status as string;
        (session as any).apiToken = token.apiToken as string;
      }
      return session;
    },
  },
});
