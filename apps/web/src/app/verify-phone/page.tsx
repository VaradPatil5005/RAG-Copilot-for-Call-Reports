"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ShieldCheck, ArrowRight, RotateCw, AlertCircle } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";

function VerifyPhoneContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();

  const phoneParam = searchParams.get("phone") || "";
  const devOtpParam = searchParams.get("devOtp") || null;

  const [phone, setPhone] = useState(phoneParam);
  const [code, setCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(devOtpParam);
  const [cooldown, setCooldown] = useState(45);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Verification failed");
      } else {
        await refreshUser();
        router.push("/copilot");
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to verify phone");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "signup_phone" }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to resend code");
      } else {
        if (data.devOtp) setDevOtp(data.devOtp);
        setCooldown(data.cooldownSeconds || 45);
      }
    } catch {
      setError("Network error resending code");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-dark relative overflow-hidden">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface/90 backdrop-blur-xl p-8 shadow-2xl relative z-10">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-full bg-evidence/10 text-evidence flex items-center justify-center mb-3">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="font-display text-lg font-bold text-text">Verify Mobile Number</h1>
          <p className="text-[12px] text-text-muted mt-1">
            Mandatory verification for confidential banking data access.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 flex items-start gap-2 text-danger text-[12px]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Free Dev Mode Helper */}
        {devOtp && (
          <div className="mb-4 rounded-xl border border-evidence/40 bg-evidence/10 p-3 text-[11px] text-evidence flex items-center justify-between">
            <div>
              <span className="font-bold">🔑 Free Dev Mode OTP:</span>{" "}
              <span className="font-mono text-base font-black tracking-widest">{devOtp}</span>
            </div>
            <button
              type="button"
              onClick={() => setCode(devOtp)}
              className="rounded border border-evidence/30 bg-evidence/20 px-2 py-0.5 text-[10px] font-bold hover:bg-evidence/30 transition-colors cursor-pointer"
            >
              Auto-fill
            </button>
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">
              Mobile Number
            </label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1 text-center">
              6-Digit Verification Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              className="w-full text-center tracking-[0.4em] font-mono text-lg rounded-xl border border-white/10 bg-elevated/40 py-2.5 text-text focus:border-evidence focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-evidence to-evidence/90 text-surface-dark py-2.5 text-[13px] font-semibold hover:opacity-95 transition-all shadow-md disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <span>Activate Account & Enter Copilot</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-4 text-center text-[12px] text-text-faint">
          Didn&apos;t receive code?{" "}
          <button
            type="button"
            disabled={cooldown > 0}
            onClick={handleResend}
            className={`font-medium ${
              cooldown > 0 ? "text-text-faint cursor-not-allowed" : "text-evidence hover:underline cursor-pointer"
            }`}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPhonePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-dark" />}>
      <VerifyPhoneContent />
    </Suspense>
  );
}
