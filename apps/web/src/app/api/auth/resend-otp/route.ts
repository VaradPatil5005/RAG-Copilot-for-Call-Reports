import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendOtp } from "@/lib/otp";

const resendSchema = z.object({
  phone: z.string().min(8),
  purpose: z.enum(["signup_phone", "login_2fa", "password_reset"]).default("signup_phone"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validation = resendSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const { phone, purpose } = validation.data;
    const result = await sendOtp(phone, purpose);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message, cooldownSeconds: result.cooldownSeconds },
        { status: 429 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      devOtp: result.devOtp,
      cooldownSeconds: result.cooldownSeconds || 45,
    });
  } catch (error: any) {
    console.error("Resend OTP error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to dispatch verification code" },
      { status: 500 }
    );
  }
}
