import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, evaluatePasswordStrength } from "@/lib/password";
import { isValidPhone, normalizePhone, sendOtp } from "@/lib/otp";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limiter";
import { CAPTCHA_ERROR_MESSAGE, verifyCaptcha } from "@/lib/captcha";
import { getClientIp } from "@/lib/client-ip";

const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(100, "Full name is too long"),
  email: z.string().trim().max(254).email("Invalid email address"),
  password: z.string().min(12, "Password must be at least 12 characters").max(256, "Password is too long"),
  phone: z.string().max(32).refine(isValidPhone, "Enter the mobile number in international format, e.g. +919876543210"),
  orgName: z.string().trim().max(120, "Organisation name is too long").optional(),
  captchaToken: z.string().max(2048).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const userAgent = req.headers.get("user-agent") || undefined;

    // Rate limit: 5 signups per hour per IP
    const rateLimit = checkRateLimit(`signup:${ip}`, 5, 3600);
    if (!rateLimit.success) {
      return NextResponse.json(
        { success: false, error: "Too many sign-up requests. Please wait and try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetInSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    const validation = signupSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues?.[0]?.message || "Invalid input data" },
        { status: 400 }
      );
    }

    const { fullName, email, password, phone, orgName, captchaToken } = validation.data;

    const captcha = await verifyCaptcha(captchaToken, ip);
    if (!captcha.ok) {
      await logAudit({ action: "signup_started", ip, userAgent, metadata: { email, rejected: "captcha", detail: captcha.reason } });
      return NextResponse.json({ success: false, error: CAPTCHA_ERROR_MESSAGE, code: "captcha" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase();
    const normalizedPhone = normalizePhone(phone);

    // Institutional Password Strength Check
    const strength = evaluatePasswordStrength(password);
    if (!strength.isValid) {
      return NextResponse.json(
        { success: false, error: "Password does not meet institutional criteria", feedback: strength.feedback },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { phone: normalizedPhone }] },
    });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "An account with this email or phone number already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    // Organisation + user are created together or not at all (previously a
    // failure between the two left orphaned organisations behind).
    const user = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: orgName || `${fullName}'s Institutional Trust`, plan: "standard" },
      });
      return tx.user.create({
        data: {
          name: fullName,
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          role: "customer", // self-serve signup is always 'customer'
          status: "pending_verification",
          phoneVerified: false,
          orgId: org.id,
        },
      });
    });

    const otpResult = await sendOtp(normalizedPhone, "signup_phone");

    await logAudit({
      userId: user.id,
      action: "signup_started",
      ip,
      userAgent,
      metadata: { email: normalizedEmail, orgId: user.orgId, role: "customer", otpSent: otpResult.success },
    });

    return NextResponse.json({
      success: true,
      phone: normalizedPhone,
      // only ever present when OTP_DEV_MODE=true outside production
      devOtp: otpResult.devOtp,
      message: otpResult.success
        ? "Account created successfully. Please verify your mobile number."
        : "Account created, but the verification code could not be sent. Use 'Resend Code'.",
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ success: false, error: "Internal server error during registration" }, { status: 500 });
  }
}
