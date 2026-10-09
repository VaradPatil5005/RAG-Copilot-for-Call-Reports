import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isValidPhone, normalizePhone, sendOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limiter";
import { CAPTCHA_ERROR_MESSAGE, verifyCaptcha } from "@/lib/captcha";
import { getClientIp } from "@/lib/client-ip";

// Only the sign-up verification flow is implemented; accepting other
// purposes let anyone trigger OTP SMS to arbitrary numbers.
const resendSchema = z.object({
  phone: z.string().max(32).refine(isValidPhone, "Invalid phone number"),
  purpose: z.literal("signup_phone").default("signup_phone"),
  captchaToken: z.string().max(2048).optional(),
});

const GENERIC_OK = "If this number belongs to an account awaiting verification, a new code has been sent.";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const ipLimit = checkRateLimit(`resend-otp:${ip}`, 10, 15 * 60);
    if (!ipLimit.success) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please wait and try again.", cooldownSeconds: ipLimit.resetInSeconds },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const validation = resendSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ success: false, error: "Invalid phone number" }, { status: 400 });
    }
    const { phone, purpose, captchaToken } = validation.data;

    // SMS costs money and can be abused for SMS-pumping / harassment, so
    // every send requires a fresh CAPTCHA.
    const captcha = await verifyCaptcha(captchaToken, ip);
    if (!captcha.ok) {
      return NextResponse.json({ success: false, error: CAPTCHA_ERROR_MESSAGE, code: "captcha" }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(phone);

    // A signed-in user without a phone on file (e.g. first Google sign-in)
    // attaches the number to *their own* account here -- never someone
    // else's, and never a number already registered.
    const session = await auth();
    if (session?.user?.id) {
      const me = await prisma.user.findUnique({ where: { id: session.user.id } });
      if (me && !me.phone && !me.phoneVerified) {
        const taken = await prisma.user.findFirst({ where: { phone: normalizedPhone }, select: { id: true } });
        if (!taken) {
          await prisma.user.update({ where: { id: me.id }, data: { phone: normalizedPhone } });
        }
      }
    }

    const pendingUser = await prisma.user.findFirst({
      where: { phone: normalizedPhone, phoneVerified: false },
      select: { id: true },
    });
    // Same response whether or not the number has a pending account, so
    // this endpoint can't be used to discover registered phone numbers.
    if (!pendingUser) {
      return NextResponse.json({ success: true, message: GENERIC_OK, cooldownSeconds: 45 });
    }

    const result = await sendOtp(normalizedPhone, purpose);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message, cooldownSeconds: result.cooldownSeconds },
        { status: 429 }
      );
    }

    return NextResponse.json({
      success: true,
      message: GENERIC_OK,
      devOtp: result.devOtp,
      cooldownSeconds: result.cooldownSeconds || 45,
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    return NextResponse.json({ success: false, error: "Failed to dispatch verification code" }, { status: 500 });
  }
}
