"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * Cloudflare Turnstile CAPTCHA widget.
 *
 * Renders the challenge and hands the resulting one-time token to
 * `onToken`. The token is worthless on its own -- the server redeems it
 * with the secret key (src/lib/captcha.ts) before any login, sign-up or
 * OTP send is processed. Call `reset()` after every submit attempt,
 * because a token can only be redeemed once.
 */

// Cloudflare-published always-pass *test* site key, used only outside
// production when no real key is configured.
const DEV_TEST_SITE_KEY = "1x00000000000000000000AA";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load CAPTCHA"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (key) return key;
  return process.env.NODE_ENV === "production" ? null : DEV_TEST_SITE_KEY;
}

export interface TurnstileHandle {
  reset: () => void;
}

interface TurnstileProps {
  onToken: (token: string | null) => void;
  action?: string;
}

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { onToken, action },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadError, setLoadError] = useState<string | null>(null);
  const siteKey = getTurnstileSiteKey();

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenRef.current(null);
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          callback: (token: string) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            onTokenRef.current(null);
            setLoadError("CAPTCHA could not be verified. Please refresh and try again.");
          },
        });
      })
      .catch(() => setLoadError("CAPTCHA failed to load. Check your connection and refresh."));
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action]);

  if (!siteKey) {
    return (
      <p className="text-[11px] text-danger" role="alert">
        Sign-in is temporarily unavailable: CAPTCHA is not configured.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={containerRef} data-testid="captcha-widget" />
      {loadError && (
        <p className="text-[11px] text-danger" role="alert">
          {loadError}
        </p>
      )}
    </div>
  );
});
