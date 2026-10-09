import crypto from "crypto";
import { prisma } from "./prisma";
import { getAuthSecret } from "./auth-token";

export type OtpPurpose = "signup_phone" | "login_2fa" | "password_reset";

const MAX_OTP_ATTEMPTS = 5;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 15 * 60 * 1000;

export interface SendOtpResult {
  success: boolean;
  message: string;
  devOtp?: string;
  cooldownSeconds?: number;
}

export interface VerifyOtpResult {
  success: boolean;
  message: string;
}

export function normalizePhone(target: string): string {
  return target.trim().replace(/[\s-]/g, "");
}

/** E.164: "+" then 8-15 digits, first digit non-zero. */
export function isValidPhone(target: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(target));
}

/**
 * Keyed hash of the OTP for storage. Plaintext OTPs are NEVER persisted.
 * A plain SHA-256 of a 6-digit code is reversible by trying all 900,000
 * values, so a leaked database would expose every live code; an HMAC
 * keyed with the server secret (and bound to target + purpose) is not.
 */
export function hashOtp(code: string, target: string, purpose: OtpPurpose): string {
  return crypto.createHmac("sha256", getAuthSecret()).update(`otp:${purpose}:${target}:${code}`).digest("hex");
}

/**
 * Dev OTP mode (code shown on screen and in the server log instead of an
 * SMS) must be an explicit opt-in and is impossible in production.
 * Previously it switched on automatically whenever Twilio keys were
 * missing -- so a deploy without Twilio returned every OTP to whoever
 * asked for it, letting anyone verify any phone number.
 */
export function isOtpDevMode(): boolean {
  return process.env.OTP_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
}

/**
 * Generates and dispatches a 6-digit numeric OTP with 5-minute expiry.
 * Enforces a maximum of 3 requests per target per 15 minutes.
 */
export async function sendOtp(target: string, purpose: OtpPurpose = "signup_phone"): Promise<SendOtpResult> {
  const normalizedTarget = normalizePhone(target);
  const now = new Date();

  const devMode = isOtpDevMode();
  if (!devMode && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)) {
    console.error("[otp] SMS provider is not configured and OTP_DEV_MODE is off -- cannot send code");
    return { success: false, message: "Verification service is temporarily unavailable." };
  }

  // Rate-limiting check: max 3 OTPs per 15 min per target
  const recentCount = await prisma.otpCode.count({
    where: {
      target: normalizedTarget,
      purpose,
      createdAt: { gte: new Date(now.getTime() - SEND_WINDOW_MS) },
    },
  });
  if (recentCount >= MAX_SENDS_PER_WINDOW) {
    return {
      success: false,
      message: "Too many OTP requests. Please wait 15 minutes before trying again.",
      cooldownSeconds: 900,
    };
  }

  // Cryptographically secure 6-digit OTP (randomInt's upper bound is exclusive)
  const rawCode = crypto.randomInt(100000, 1000000).toString();
  const codeHash = hashOtp(rawCode, normalizedTarget, purpose);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  // Invalidate any prior unconsumed OTPs for this target & purpose
  await prisma.otpCode.updateMany({
    where: { target: normalizedTarget, purpose, consumedAt: null },
    data: { consumedAt: now },
  });

  await prisma.otpCode.create({
    data: { target: normalizedTarget, codeHash, purpose, attempts: 0, expiresAt },
  });

  if (devMode) {
    console.log(`[TATHYX DEV OTP] target=${normalizedTarget} purpose=${purpose} code=${rawCode} (expires in 5 min)`);
    return {
      success: true,
      message: "OTP sent successfully (Simulated in Dev Mode)",
      devOtp: rawCode,
      cooldownSeconds: 45,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: `Your Tathyx AI verification code is: ${rawCode}. Valid for 5 minutes. Do not share this with anyone.`,
      to: normalizedTarget,
      from: process.env.TWILIO_FROM_NUMBER || "TATHYX",
    });
    return { success: true, message: "Verification code sent via SMS", cooldownSeconds: 45 };
  } catch (error) {
    console.error("Failed to deliver Twilio SMS:", error);
    return { success: false, message: "Failed to dispatch SMS. Please verify your phone number." };
  }
}

/**
 * Verifies a user-supplied OTP against the stored keyed hash.
 * Enforces a strict maximum of 5 attempts per code.
 */
export async function verifyOtp(
  target: string,
  code: string,
  purpose: OtpPurpose = "signup_phone"
): Promise<VerifyOtpResult> {
  const normalizedTarget = normalizePhone(target);
  const normalizedCode = code.trim();
  const now = new Date();

  const record = await prisma.otpCode.findFirst({
    where: { target: normalizedTarget, purpose, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) {
    return {
      success: false,
      message: "Verification code has expired or was not requested. Please request a new code.",
    };
  }

  // Reserve an attempt atomically *before* comparing. The conditional
  // update (attempts < 5) means parallel guesses cannot all read the same
  // counter and blow past the limit -- the old read-then-increment let a
  // burst of concurrent requests make unlimited guesses at a 6-digit code.
  const reserved = await prisma.otpCode.updateMany({
    where: { id: record.id, consumedAt: null, attempts: { lt: MAX_OTP_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    await prisma.otpCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: now } });
    return { success: false, message: "Maximum verification attempts exceeded. Please request a new code." };
  }

  if (!/^\d{6}$/.test(normalizedCode)) {
    return { success: false, message: "Invalid code." };
  }

  const candidateHash = hashOtp(normalizedCode, normalizedTarget, purpose);
  const isMatch = crypto.timingSafeEqual(Buffer.from(candidateHash, "utf-8"), Buffer.from(record.codeHash, "utf-8"));
  if (!isMatch) {
    const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
    return {
      success: false,
      message: `Invalid code. ${remaining > 0 ? `${remaining} attempts remaining.` : "Code locked."}`,
    };
  }

  // Consume exactly once: a concurrent second success on the same code
  // matches zero rows and is rejected.
  const consumed = await prisma.otpCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count === 0) {
    return { success: false, message: "Verification code has already been used." };
  }

  return { success: true, message: "Phone number verified successfully." };
}
