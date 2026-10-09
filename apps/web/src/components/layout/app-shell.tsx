"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

// Auth screens render full-bleed (their own split layout), without app chrome.
const BARE_ROUTES = new Set(["/login", "/signup", "/verify-phone"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname && BARE_ROUTES.has(pathname)) {
    return <div className="min-h-screen w-full overflow-y-auto bg-bg">{children}</div>;
  }
  return (
    <div className="flex flex-col lg:flex-row h-screen w-full overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col h-full min-w-0 overflow-hidden">
        <main className="flex-1 h-full min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
