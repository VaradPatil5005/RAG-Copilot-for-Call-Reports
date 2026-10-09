import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isValidPhone, normalizePhone, verifyOtp } from "@/lib/otp";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getClientIp } from "@/lib/client-ip";

const verifySchema = z.object({
  phone: z.string().max(32).refine(isValidPhone, "Invalid phone number"),
  code: z.string().regex(/^\d{6}$/, "Verification code must be 6 digits"),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const userAgent = req.headers.get("user-agent") || undefined;

    // Per-code attempts are capped in verifyOtp; this caps guessing across
    // many phone numbers from one client.
    const ipLimit = checkRateLimit(`verify-phone:${ip}`, 20, 15 * 60);
    if (!ipLimit.success) {
      return NextResponse.json({ success: false, error: "Too many attempts. Please wait and try again." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const validation = verifySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues?.[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(validation.data.phone);
    const result = await verifyOtp(normalizedPhone, validation.data.code, "signup_phone");
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    const user = await prisma.user.findFirst({ where: { phone: normalizedPhone } });
    if (!user) {
      return NextResponse.json({ success: false, error: "Associated user profile not found" }, { status: 404 });
    }

    // Only activate accounts that are waiting for verification -- never
    // reactivate a suspended/disabled account through this endpoint.
    if (user.status === "suspended" || user.status === "disabled") {
      return NextResponse.json({ success: false, error: "This account is not active." }, { status: 403 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerified: true, status: "active" },
    });

    await logAudit({
      userId: user.id,
      action: "phone_verified",
      ip,
      userAgent,
      metadata: { phone: normalizedPhone, role: user.role },
    });

    // No API token is returned here any more: tokens are only issued to an
    // authenticated session via /api/auth/api-token.
    return NextResponse.json({
      success: true,
      message: "Phone number verified successfully. Account activated.",
    });
  } catch (error) {
    console.error("Phone verification error:", error);
    return NextResponse.json({ success: false, error: "Internal server error during verification" }, { status: 500 });
  }
}
