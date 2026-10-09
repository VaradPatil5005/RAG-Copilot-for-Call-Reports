"use client";

import React, { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useAuth } from "./auth-context";
import {
  X,
  Lock,
  Mail,
  ShieldCheck,
  Smartphone,
  Sparkles,
  ArrowRight,
  AlertCircle,
  Building2,
  CheckCircle2,
  RotateCw,
} from "lucide-react";
import { evaluatePasswordStrength } from "@/lib/password-rules";
import { Turnstile, type TurnstileHandle } from "./turnstile";
import { DEMO_LOGINS_ENABLED, signInErrorMessage } from "@/lib/auth-errors";
import { clearAuthToken } from "@/lib/auth";
import { BrandMark } from "@/components/ui/brand";

export function AuthModal() {
  const { isAuthModalOpen, closeAuthModal, completeAuthSuccess, pendingActionTitle, refreshUser } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [step, setStep] = useState<"form" | "otp">("form");

  // Form states
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("+91");
  const [orgName, setOrgName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  // OTP state
  const [otpCode, setOtpCode] = useState("");
  const [simulatedDevOtp, setSimulatedDevOtp] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Status & Error
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // CAPTCHA token for the next server call. Tokens are single-use, so the
  // widget is reset after every request that consumed one.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);
  const consumeCaptcha = () => {
    const token = captchaToken;
    captchaRef.current?.reset();
    return token;
  };

  // Resend countdown. Previously `cooldown` was set to 45 and never
  // decremented, so "Resend Code" stayed disabled forever.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!isAuthModalOpen) return null;

  const strength = evaluatePasswordStrength(password);

  // Quick 1-Click Test Login
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
        captchaToken: consumeCaptcha(),
      });

      const message = signInErrorMessage(res);
      if (message) {
        setError(message);
      } else {
        clearAuthToken();
        await refreshUser();
        completeAuthSuccess();
      }
    } catch (err: any) {
      setError(err?.message || "Quick login failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Email/Password Sign In
  const handleSignIn = async (e: React.FormEvent) => {
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
        captchaToken: consumeCaptcha(),
      });

      const message = signInErrorMessage(res);
      if (message) {
        setError(message);
      } else {
        clearAuthToken();
        await refreshUser();
        completeAuthSuccess();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Account Creation
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!strength.isValid) {
      setError(strength.feedback[0] || "Password does not meet institutional standards");
      setIsLoading(false);
      return;
    }
    if (!captchaToken) {
      setError("Please complete the security check first.");
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
          password,
          phone,
          orgName,
          captchaToken: consumeCaptcha(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Failed to create account");
      } else {
        if (data.devOtp) {
          setSimulatedDevOtp(data.devOtp);
        }
        if (data.phone) setPhone(data.phone);
        setStep("otp");
        setSuccessMsg(data.message || "Account created! Please verify your mobile number.");
        setCooldown(45);
      }
    } catch (err: any) {
      setError(err?.message || "Registration request failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle OTP Verification
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) {
      setError("Please complete the security check first.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          code: otpCode,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Invalid verification code");
      } else {
        // Auto-login newly verified user
        const signInRes = await signIn("credentials", {
          redirect: false,
          email,
          password,
          rememberMe: "true",
          captchaToken: consumeCaptcha(),
        });
        const message = signInErrorMessage(signInRes);
        if (message) {
          setError(`Phone verified, but automatic sign-in failed: ${message}`);
          setStep("form");
          setTab("signin");
          return;
        }
        clearAuthToken();
        await refreshUser();
        completeAuthSuccess();
      }
    } catch (err: any) {
      setError(err?.message || "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (cooldown > 0) return;
    if (!captchaToken) {
      setError("Please complete the security check first.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "signup_phone", captchaToken: consumeCaptcha() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to resend code");
      } else {
        if (data.devOtp) setSimulatedDevOtp(data.devOtp);
        setSuccessMsg(data.message || "A new verification code has been dispatched.");
        setCooldown(data.cooldownSeconds || 45);
      }
    } catch {
      setError("Network error resending code");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-surface/95 backdrop-blur-2xl p-6 border-border-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute top-4 right-4 h-8 w-8 rounded-lg flex items-center justify-center text-text-faint hover:text-text hover:bg-elevated transition-colors"
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-4">
          <BrandMark className="h-10 w-10 rounded-[10px] text-[24px]" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-medium text-text">Tathyx AI</h3>
              <span className="rounded border border-evidence/30 bg-evidence/10 px-1.5 py-0.2 font-mono text-[9px] text-evidence font-medium">
                RBAC SECURED
              </span>
            </div>
            <p className="text-[11px] text-text-muted">Enterprise Decision Intelligence</p>
          </div>
        </div>

        {/* Action Trigger Badge (Perplexity Style) */}
        {pendingActionTitle && (
          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/8 p-3 flex items-start gap-2.5">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[12px] text-text-muted leading-relaxed">
              <span className="font-medium text-text">{pendingActionTitle}</span>
            </p>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 flex items-start gap-2 text-danger text-[12px]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="mb-4 rounded-xl border border-success/30 bg-success/10 p-3 flex items-start gap-2 text-success text-[12px]">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {step === "form" ? (
          <>
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

            <div className="relative flex items-center justify-center my-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border-subtle" />
              </div>
              <span className="relative bg-surface px-3 text-[11px] font-mono text-text-faint uppercase">
                or manual credentials
              </span>
            </div>

            {/* Tab switch */}
            <div className="flex rounded-xl bg-elevated/80 p-1 mb-4 border border-white/5">
              <button
                type="button"
                onClick={() => {
                  setTab("signin");
                  setError(null);
                }}
                className={`flex-1 rounded-lg py-1.5 text-[12px] font-medium transition-all ${
                  tab === "signin"
                    ? "bg-surface text-text shadow-sm border border-white/10"
                    : "text-text-faint hover:text-text-muted"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("signup");
                  setError(null);
                }}
                className={`flex-1 rounded-lg py-1.5 text-[12px] font-medium transition-all ${
                  tab === "signup"
                    ? "bg-surface text-text shadow-sm border border-white/10"
                    : "text-text-faint hover:text-text-muted"
                }`}
              >
                Create Account
              </button>
            </div>

            <div className="mb-3">
              <Turnstile ref={captchaRef} onToken={setCaptchaToken} action="auth" />
            </div>

            {/* Sign In Form */}
            {tab === "signin" ? (
              <form onSubmit={handleSignIn} className="space-y-3">
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
                      className="w-full rounded-xl border border-white/10 bg-elevated/40 pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-text-muted">
                      Password
                    </label>
                    <a
                      href="#forgot"
                      onClick={(e) => {
                        e.preventDefault();
                        alert("Please contact your organization administrator to reset your institutional credentials.");
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
                      className="w-full rounded-xl border border-white/10 bg-elevated/40 pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* Keep me logged in checkbox */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-elevated accent-evidence focus:ring-0 cursor-pointer"
                  />
                  <label
                    htmlFor="rememberMe"
                    className="text-[11px] text-text-muted cursor-pointer select-none"
                  >
                    Keep me logged in all the time (30-day persistent session)
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !captchaToken}
                  className="w-full mt-3 flex items-center justify-center gap-2 rounded-xl bg-brand-fill hover:bg-brand-press text-paper py-2.5 text-[13px] font-semibold transition-all shadow-md disabled:opacity-50 cursor-pointer"
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
            ) : (
              /* Sign Up Form */
              <form onSubmit={handleSignUp} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Varad Patil"
                    className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Work Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="analyst@firm.com"
                    className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none transition-colors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-text-muted mb-1">
                      Mobile Number
                    </label>
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
                    <label className="block text-[11px] font-medium text-text-muted mb-1">
                      Org / Firm (Optional)
                    </label>
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
                    className="w-full rounded-xl border border-white/10 bg-elevated/40 px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:border-evidence focus:outline-none transition-colors"
                  />
                  {password && (
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-text-faint">Security Level:</span>
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
                    id="rememberMeSignup"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-elevated accent-evidence focus:ring-0 cursor-pointer"
                  />
                  <label
                    htmlFor="rememberMeSignup"
                    className="text-[11px] text-text-muted cursor-pointer select-none"
                  >
                    Keep me logged in on this device
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !strength.isValid || !captchaToken}
                  className="w-full mt-3 flex items-center justify-center gap-2 rounded-xl bg-brand-fill hover:bg-brand-press text-paper py-2.5 text-[13px] font-semibold transition-all shadow-md disabled:opacity-50 cursor-pointer"
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
            )}
          </>
        ) : (
          /* Step 2: OTP Verification Screen */
          <form onSubmit={handleVerifyOtp} className="space-y-4 animate-in fade-in duration-200">
            <div className="text-center py-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-evidence/10 text-evidence mb-2">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-semibold text-text">Verify Mobile Number</h4>
              <p className="text-[11px] text-text-muted mt-0.5">
                Enter the 6-digit verification code sent to <span className="font-mono text-text">{phone}</span>
              </p>
            </div>

            {/* Dev Mode Interactive Toast / Helper */}
            {simulatedDevOtp && (
              <div className="rounded-xl border border-evidence/40 bg-evidence/10 p-3 text-[11px] text-evidence flex items-center justify-between">
                <div>
                  <span className="font-bold">Development OTP:</span>{" "}
                  <span className="font-mono text-base font-black tracking-widest">{simulatedDevOtp}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOtpCode(simulatedDevOtp)}
                  className="rounded border border-evidence/30 bg-evidence/20 px-2 py-0.5 text-[10px] font-bold hover:bg-evidence/30 transition-colors cursor-pointer"
                >
                  Auto-fill
                </button>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-text-muted mb-1 text-center">
                6-Digit Code
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full text-center tracking-[0.4em] font-mono text-lg rounded-xl border border-white/10 bg-elevated/40 py-2.5 text-text placeholder:text-text-faint focus:border-evidence focus:outline-none"
              />
            </div>

            <Turnstile ref={captchaRef} onToken={setCaptchaToken} action="verify" />

            <button
              type="submit"
              disabled={isLoading || otpCode.length !== 6 || !captchaToken}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-fill hover:bg-brand-press text-paper py-2.5 text-[13px] font-semibold transition-all shadow-md disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <RotateCw className="h-4 w-4 animate-spin" />
              ) : (
                <span>Activate Account & Proceed</span>
              )}
            </button>

            <div className="flex items-center justify-between text-[11px] text-text-faint pt-1">
              <button
                type="button"
                onClick={() => setStep("form")}
                className="hover:text-text-muted hover:underline"
              >
                Change details
              </button>

              <button
                type="button"
                disabled={cooldown > 0}
                onClick={handleResendOtp}
                className={`hover:underline ${
                  cooldown > 0 ? "text-text-faint cursor-not-allowed" : "text-evidence cursor-pointer"
                }`}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
