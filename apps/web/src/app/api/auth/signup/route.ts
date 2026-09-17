import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, evaluatePasswordStrength } from "@/lib/password";
import { sendOtp } from "@/lib/otp";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limiter";

const signupSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(12, "Password must be at least 12 characters"),
  phone: z.string().min(8, "Phone number is too short"),
  orgName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || undefined;

    // Rate limit: 5 signups per hour per IP
    const rateLimit = checkRateLimit(`signup:${ip}`, 5, 3600);
    if (!rateLimit.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Too many sign-up requests from this IP. Please wait an hour.",
        },
        { status: 429 }
      );
    }

    const body = await req.json();
    const validation = signupSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues?.[0]?.message || "Invalid input data",
        },
        { status: 400 }
      );
    }

    const { fullName, email, password, phone, orgName } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedPhone = phone.trim().replace(/[\s-]/g, "");

    // Institutional Password Strength Check
    const strength = evaluatePasswordStrength(password);
    if (!strength.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: "Password does not meet institutional criteria",
          feedback: strength.feedback,
        },
        { status: 400 }
      );
    }

    // Check for existing user by email or phone
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { phone: normalizedPhone }],
      },
    });

    if (existingUser) {
      return NextResponse.json(
        {
          success: false,
          error: "An account with this email or phone number already exists.",
        },
        { status: 409 }
      );
    }

    // Create or locate organization
    const resolvedOrgName = orgName?.trim() || `${fullName}'s Institutional Trust`;
    const org = await prisma.organization.create({
      data: {
        name: resolvedOrgName,
        plan: "standard",
      },
    });

    // Hash password with Argon2id
    const passwordHash = await hashPassword(password);

    // Create User record in pending_verification state
    const user = await prisma.user.create({
      data: {
        name: fullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        role: "customer", // Default self-serve signup is always 'customer'
        status: "pending_verification",
        phoneVerified: false,
        orgId: org.id,
      },
    });

    // Send initial 6-digit OTP
    const otpResult = await sendOtp(normalizedPhone, "signup_phone");

    // Compliance Audit Logging
    await logAudit({
      userId: user.id,
      action: "signup_started",
      ip,
      userAgent,
      metadata: {
        email: normalizedEmail,
        orgId: org.id,
        orgName: org.name,
        role: "customer",
      },
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      phone: normalizedPhone,
      devOtp: otpResult.devOtp,
      message: "Account created successfully. Please verify your mobile number.",
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error during registration" },
      { status: 500 }
    );
  }
}
