import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/components/auth/auth-context";
import { AuthModal } from "@/components/auth/auth-modal";

export const metadata: Metadata = {
  title: "Tathyx AI: Enterprise Decision Intelligence Copilot for Call Reports",
  description:
    "Autonomous decision intelligence copilot for enterprise call reports: deterministic ground truth, zero hallucination, page-level citations, and loan covenant audit guardrails.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased dark" suppressHydrationWarning>
      <body
        className="min-h-full flex flex-col app-backdrop cyber-grid selection:bg-evidence/20 selection:text-evidence"
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
