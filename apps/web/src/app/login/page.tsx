"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Lock, Mail, ArrowRight, AlertCircle, RotateCw, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Turnstile, type TurnstileHandle } from "@/components/auth/turnstile";
import { DEMO_LOGINS_ENABLED, signInErrorMessage } from "@/lib/auth-errors";
import { clearAuthToken } from "@/lib/auth";

/** Only same-origin relative paths -- never redirect to an attacker URL. */
import { AuthShell } from "@/components/auth/auth-shell";

function safeCallbackUrl(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);

  const finishSignIn = async (res: Awaited<ReturnType<typeof signIn>> | undefined) => {
    // A CAPTCHA token is single-use: always get a fresh one for the next try.
    captchaRef.current?.reset();
    const message = signInErrorMessage(res);
    if (message) {
      setError(message);
      return;
    }
    clearAuthToken();
    await refreshUser();
    const params = new URLSearchParams(window.location.search);
    router.push(safeCallbackUrl(params.get("callbackUrl")));
    router.refresh();
  };

  const handleQuickLogin = async (quickEmail: string, quickPass: string) => {
    if (!captchaToken) {
      setError("Please complete the security check first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        email: quickEmail,
        password: quickPass,
        rememberMe: "true",
        captchaToken,
      });
      await finishSignIn(res);
    } catch (err: any) {
      setError(err?.message || "Quick login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) {
      setError("Please complete the security check first.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
        rememberMe: rememberMe ? "true" : "false",
        captchaToken,
      });
      await finishSignIn(res);
    } catch (err: any) {
      setError(err?.message || "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell>
      <div>
        {/* Brand Header */}
        <div className="mb-8">
          <h1 className="font-display text-[1.9rem] font-medium leading-tight text-text">
            Welcome back
          </h1>
          <p className="text-[13px] text-text-muted mt-2">
            Sign in to your decision intelligence workspace.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 flex items-start gap-2 text-danger text-[12px]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Quick 1-Click Test Accounts for Local Dev (hidden unless explicitly enabled) */}
        {DEMO_LOGINS_ENABLED && (
        <div className="mb-4 rounded-xl border border-primary/25 bg-primary/[0.04] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Instant Local Dev Logins (1-Click)
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">Dev only</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "Credit Analyst", email: "analyst@tathyx.ai", pass: "TathyxAnalyst2026!" },
              { label: "Client Portfolio", email: "customer@tathyx.ai", pass: "TathyxCustomer2026!" },
              { label: "Risk Admin", email: "admin@tathyx.ai", pass: "TathyxAdmin2026!" },
              { label: "Super Admin", email: "superadmin@tathyx.ai", pass: "TathyxSuperAdmin2026!" },
            ].map((item) => (
              <button
                key={item.email}
                type="button"
                disabled={isLoading}
                onClick={() => handleQuickLogin(item.email, item.pass)}
                className="flex flex-col text-left px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-evidence/50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="text-[12px] font-medium text-white leading-tight">
                  {item.label}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono truncate">
                  {item.email}
                </span>
              </button>
            ))}
          </div>
        </div>
        )}

        <div className="relative flex items-center justify-center my-4">
          <div className="w-full border-t border-border-subtle" />
          <span className="absolute bg-bg px-3 text-[11px] font-mono text-text-faint uppercase">
            or work email
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">
              Work Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-text-faint" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="analyst@firm.com"
                className="w-full rounded-xl border border-white/10 bg-elevated/40 pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-text-muted">Password</label>
              <a
                href="#help"
                onClick={(e) => {
                  e.preventDefault();
                  alert("Please contact your organization administrator to reset credentials.");
                }}
                className="text-[11px] text-evidence/80 hover:text-evidence hover:underline"
              >
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-text-faint" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-xl border border-white/10 bg-elevated/40 pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="pageRememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-elevated accent-evidence cursor-pointer"
            />
            <label htmlFor="pageRememberMe" className="text-[11px] text-text-muted cursor-pointer">
              Keep me signed in on this device (30-day session)
            </label>
          </div>

          <Turnstile ref={captchaRef} onToken={setCaptchaToken} action="login" />

          <button
            type="submit"
            disabled={isLoading || !captchaToken}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-brand-fill hover:bg-brand-press text-paper py-2.5 text-[13px] font-semibold transition-all shadow-md disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <span>Sign In to Tathyx</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-[12px] text-text-faint">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-evidence hover:underline font-medium">
            Create an institutional account
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
