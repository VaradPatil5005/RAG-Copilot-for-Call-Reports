import crypto from "crypto";
import { prisma } from "./prisma";

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

/**
 * Computes a deterministic SHA-256 hash of the OTP for storage.
 * Plaintext OTPs are NEVER persisted to the database.
 */
export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Generates and dispatches a 6-digit numeric OTP with 5-minute expiry.
 * Enforces a maximum of 3 requests per target per 15 minutes.
 */
export async function sendOtp(
  target: string,
  purpose: "signup_phone" | "login_2fa" | "password_reset" = "signup_phone"
): Promise<SendOtpResult> {
  const normalizedTarget = target.trim().replace(/[\s-]/g, "");
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Rate-limiting check: max 3 OTPs per 15 min
  const recentCount = await prisma.otpCode.count({
    where: {
      target: normalizedTarget,
      purpose,
      createdAt: { gte: fifteenMinutesAgo },
    },
  });

  if (recentCount >= 3) {
    return {
      success: false,
      message: "Too many OTP requests. Please wait 15 minutes before trying again.",
      cooldownSeconds: 900,
    };
  }

  // Generate cryptographically secure 6-digit OTP
  const rawCode = crypto.randomInt(100000, 999999).toString();
  const codeHash = hashOtp(rawCode);
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes TTL

  // Invalidate any prior unconsumed OTPs for this target & purpose
  await prisma.otpCode.updateMany({
    where: {
      target: normalizedTarget,
      purpose,
      consumedAt: null,
    },
    data: {
      consumedAt: now, // mark as invalidated
    },
  });

  // Store hashed OTP
  await prisma.otpCode.create({
    data: {
      target: normalizedTarget,
      codeHash,
      purpose,
      attempts: 0,
      expiresAt,
    },
  });

  const isDevMode =
    process.env.OTP_DEV_MODE === "true" ||
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN;

  if (isDevMode) {
    console.log("\n============================================================");
    console.log(`🔑 [TATHYX AI DEV OTP SIMULATOR]`);
    console.log(`📱 Target:  ${normalizedTarget}`);
    console.log(`🎯 Purpose: ${purpose}`);
    console.log(`⚡ CODE:    >>> ${rawCode} <<<`);
    console.log(`⏳ Expires: 5 minutes (${expiresAt.toLocaleTimeString()})`);
    console.log("============================================================\n");

    return {
      success: true,
      message: "OTP sent successfully (Simulated in Dev Mode)",
      devOtp: rawCode,
      cooldownSeconds: 45,
    };
  }

  // Real Twilio delivery if credentials are provided
  try {
    const twilio = require("twilio")(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilio.messages.create({
      body: `Your Tathyx AI verification code is: ${rawCode}. Valid for 5 minutes. Do not share this with anyone.`,
      to: normalizedTarget,
      from: process.env.TWILIO_FROM_NUMBER || "TATHYX",
    });

    return {
      success: true,
      message: "Verification code sent via SMS",
      cooldownSeconds: 45,
    };
  } catch (error: any) {
    console.error("Failed to deliver Twilio SMS:", error);
    return {
      success: false,
      message: "Failed to dispatch SMS. Please verify your phone number.",
    };
  }
}

/**
 * Verifies user-supplied OTP against the stored SHA-256 hash.
 * Enforces a strict maximum of 5 attempts.
 */
export async function verifyOtp(
  target: string,
  code: string,
  purpose: "signup_phone" | "login_2fa" | "password_reset" = "signup_phone"
): Promise<VerifyOtpResult> {
  const normalizedTarget = target.trim().replace(/[\s-]/g, "");
  const normalizedCode = code.trim();
  const now = new Date();

  // Find latest active OTP code
  const record = await prisma.otpCode.findFirst({
    where: {
      target: normalizedTarget,
      purpose,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    return {
      success: false,
      message: "Verification code has expired or was not requested. Please request a new code.",
    };
  }

  if (record.attempts >= 5) {
    // Invalidate record due to max attempts exceeded
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: now },
    });
    return {
      success: false,
      message: "Maximum verification attempts exceeded. Please request a new code.",
    };
  }

  const candidateHash = hashOtp(normalizedCode);
  const isMatch = crypto.timingSafeEqual(
    Buffer.from(candidateHash, "utf-8"),
    Buffer.from(record.codeHash, "utf-8")
  );

  if (!isMatch) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = 4 - record.attempts;
    return {
      success: false,
      message: `Invalid code. ${remaining > 0 ? `${remaining} attempts remaining.` : "Code locked."}`,
    };
  }

  // Successful verification -> consume code
  await prisma.otpCode.update({
    where: { id: record.id },
    data: { consumedAt: now },
  });

  return {
    success: true,
    message: "Phone number verified successfully.",
  };
}
