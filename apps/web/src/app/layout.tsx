import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/components/auth/auth-context";
import { AuthModal } from "@/components/auth/auth-modal";

// Self-hosted at build time by next/font (no runtime request to Google,
// so the CSP can keep `font-src 'self'`).
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
});
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Tathyx AI: Enterprise Decision Intelligence Copilot for Call Reports",
  description:
    "Autonomous decision intelligence copilot for enterprise call reports: deterministic ground truth, zero hallucination, page-level citations, and loan covenant audit guardrails.",
};

export const viewport: Viewport = {
  themeColor: "#101010",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: the CSP nonce set in src/proxy.ts is only applied
  // to Next's scripts during dynamic rendering. A statically pre-rendered
  // page would ship scripts without the nonce and the CSP would block them.
  await connection();
  return (
    <html
      lang="en"
      className={`h-full antialiased dark ${fraunces.variable} ${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col app-backdrop cyber-grid"
        suppressHydrationWarning
      >
        <AuthProvider>
          <AppShell>{children}</AppShell>
          <AuthModal />
        </AuthProvider>
      </body>
    </html>
  );
}
