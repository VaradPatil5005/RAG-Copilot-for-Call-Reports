import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyOtp } from "@/lib/otp";
import { logAudit } from "@/lib/audit";
import { mintApiToken } from "@/lib/auth-token";

const verifySchema = z.object({
  phone: z.string().min(8),
  code: z.string().length(6, "Verification code must be 6 digits"),
});

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || undefined;

    const body = await req.json();
    const validation = verifySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues?.[0]?.message || "Invalid input",
        },
        { status: 400 }
      );
    }

    const { phone, code } = validation.data;
    const normalizedPhone = phone.trim().replace(/[\s-]/g, "");

    // Verify OTP against hashed record
    const result = await verifyOtp(normalizedPhone, code, "signup_phone");

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 400 }
      );
    }

    // Locate user and promote to active status
    const user = await prisma.user.findFirst({
      where: { phone: normalizedPhone },
      include: { org: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Associated user profile not found" },
        { status: 404 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        phoneVerified: true,
        status: "active",
      },
    });

    await logAudit({
      userId: user.id,
      action: "phone_verified",
      ip,
      userAgent,
      metadata: { phone: normalizedPhone, role: user.role },
    });

    // Mint token for immediate client execution if needed
    const apiToken = await mintApiToken({
      sub: user.id,
      tenant_id: user.orgId || "tenant-a",
      principals: [user.role, `org:${user.orgId || "default"}`, user.email],
      role: user.role,
      email: user.email,
      name: user.name || undefined,
      phoneVerified: true,
    });

    return NextResponse.json({
      success: true,
      message: "Phone number verified successfully. Account activated.",
      apiToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        orgName: user.org?.name,
        phoneVerified: true,
      },
    });
  } catch (error: any) {
    console.error("Phone verification error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error during verification" },
      { status: 500 }
    );
  }
}
