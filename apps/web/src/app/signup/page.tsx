"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Radar, Smartphone, Building2, ArrowRight, AlertCircle, RotateCw } from "lucide-react";
import { evaluatePasswordStrength } from "@/lib/password-rules";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+91");
  const [orgName, setOrgName] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = evaluatePasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!strength.isValid) {
      setError(strength.feedback[0] || "Password does not meet institutional standards");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          orgName,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Failed to create account");
      } else {
        // Redirect to verify-phone page with query params
        const params = new URLSearchParams({
          phone,
          email,
          ...(data.devOtp ? { devOtp: data.devOtp } : {}),
        });
        router.push(`/verify-phone?${params.toString()}`);
      }
    } catch (err: any) {
      setError(err?.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-dark relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-evidence/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface/90 backdrop-blur-xl p-8 shadow-2xl relative z-10">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-elevated-2 border border-white/10 flex items-center justify-center shadow-inner mb-3">
            <Radar className="h-6 w-6 text-evidence" strokeWidth={2} />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-text">
            Join Tathyx AI
          </h1>
          <p className="text-[12px] text-text-muted mt-1">
            Enterprise Decision Intelligence for Call Reports
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 flex items-start gap-2 text-danger text-[12px]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={() => signIn("google")}
          className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-elevated/70 hover:bg-elevated hover:border-white/20 py-2.5 px-4 text-[13px] font-medium text-text transition-all shadow-sm mb-4 cursor-pointer"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Sign up with Google</span>
        </button>

        <div className="relative flex items-center justify-center my-4">
          <div className="w-full border-t border-border-subtle" />
          <span className="absolute bg-surface px-3 text-[11px] font-mono text-text-faint uppercase">
            or work email
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Varad Patil"
              className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="analyst@firm.com"
              className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-text-muted mb-1">Mobile Number</label>
              <div className="relative">
                <Smartphone className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-faint" />
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full rounded-xl border border-white/10 bg-elevated/40 pl-8 pr-2 py-2 text-[12px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-text-muted mb-1">Org (Optional)</label>
              <div className="relative">
                <Building2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-faint" />
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Apex Capital"
                  className="w-full rounded-xl border border-white/10 bg-elevated/40 pl-8 pr-2 py-2 text-[12px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">
              Password (Min 12 chars, institutional criteria)
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
            />
            {password && (
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-text-faint">Strength:</span>
                  <span
                    className={`font-semibold ${
                      strength.score >= 3
                        ? "text-success"
                        : strength.score === 2
                        ? "text-primary"
                        : "text-danger"
                    }`}
                  >
                    {strength.label}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 h-1">
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className={`rounded-full transition-all ${
                        strength.score > idx
                          ? strength.score >= 3
                            ? "bg-success"
                            : "bg-primary"
                          : "bg-white/10"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="signupRememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-elevated accent-evidence cursor-pointer"
            />
            <label htmlFor="signupRememberMe" className="text-[11px] text-text-muted cursor-pointer">
              Keep me logged in on this device
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading || !strength.isValid}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-evidence to-evidence/90 text-surface-dark py-2.5 text-[13px] font-semibold hover:opacity-95 transition-all shadow-md disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <span>Proceed to Mobile Verification</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-[12px] text-text-faint">
          Already have an account?{" "}
          <Link href="/login" className="text-evidence hover:underline font-medium">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
