import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  try {
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json({
        authenticated: false,
        user: null,
      });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: (session.user as any).role || "customer",
        orgId: (session.user as any).orgId,
        orgName: (session.user as any).orgName,
        phoneVerified: (session.user as any).phoneVerified ?? false,
        status: (session.user as any).status,
      },
    });
  } catch (error) {
    return NextResponse.json({ authenticated: false, user: null });
  }
}
