import { prisma } from "./prisma";

export type AuditAction =
  | "login_success"
  | "login_failed"
  | "account_locked"
  | "signup_started"
  | "phone_verified"
  | "session_refreshed"
  | "logout"
  | "role_changed"
  | "document_uploaded"
  | "query_executed"
  | "covenant_evaluated"
  | "data_exported";

export interface AuditContext {
  userId?: string | null;
  action: AuditAction;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Persists an immutable compliance audit record for institutional audit readiness.
 * Sanitizes sensitive payload fields (passwords, raw tokens, and OTPs are stripped).
 */
export async function logAudit(context: AuditContext): Promise<void> {
  try {
    const cleanMeta = context.metadata ? { ...context.metadata } : {};
    // Ensure sensitive secrets are NEVER stored in audit logs
    delete cleanMeta.password;
    delete cleanMeta.passwordHash;
    delete cleanMeta.code;
    delete cleanMeta.rawCode;
    delete cleanMeta.token;
    delete cleanMeta.authorization;

    await prisma.auditLog.create({
      data: {
        userId: context.userId || null,
        action: context.action,
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        metadata: Object.keys(cleanMeta).length > 0 ? JSON.stringify(cleanMeta) : null,
      },
    });
  } catch (error) {
    // Non-fatal: audit failure should be logged to console without breaking user response
    console.error(`[AUDIT_LOG_ERROR] Failed to write audit event ${context.action}:`, error);
  }
}
