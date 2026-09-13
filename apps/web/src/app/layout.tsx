import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Google Antigravity // Decision Intelligence Copilot",
  description:
    "Zero-gravity layout-aware hybrid RAG copilot for enterprise call reports: grounded answers, page-level citations, cross-document intelligence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col app-backdrop cyber-grid selection:bg-evidence/20 selection:text-evidence">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
