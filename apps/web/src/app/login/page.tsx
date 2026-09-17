"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Radar, Lock, Mail, ArrowRight, AlertCircle, RotateCw } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
        rememberMe: rememberMe ? "true" : "false",
      });

      if (res?.error) {
        setError(res.error);
      } else {
        await refreshUser();
        router.push("/");
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-dark relative overflow-hidden">
      {/* Background glow accents */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-evidence/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 rounded-full bg-primary/10 blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface/90 backdrop-blur-xl p-8 shadow-2xl relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-elevated-2 border border-white/10 flex items-center justify-center shadow-inner mb-3">
            <Radar className="h-6 w-6 text-evidence" strokeWidth={2} />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-text">
            Tathyx AI
          </h1>
          <p className="text-[12px] text-text-muted mt-1">
            Enterprise Decision Intelligence Copilot for Call Reports
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 flex items-start gap-2 text-danger text-[12px]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* 1-Click Google Login */}
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
          <span>Continue with Google</span>
        </button>

        <div className="relative flex items-center justify-center my-4">
          <div className="w-full border-t border-border-subtle" />
          <span className="absolute bg-surface px-3 text-[11px] font-mono text-text-faint uppercase">
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

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-hover text-surface-dark py-2.5 text-[13px] font-semibold hover:opacity-95 transition-all shadow-md disabled:opacity-50 cursor-pointer"
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
    </div>
  );
}
