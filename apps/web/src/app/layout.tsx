import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Enterprise RAG Copilot — Call Reports",
  description:
    "Layout-aware hybrid RAG copilot for enterprise call reports: grounded answers, page-level citations, cross-document intelligence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col app-backdrop">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
