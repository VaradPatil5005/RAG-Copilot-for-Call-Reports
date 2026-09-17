"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Radar,
  Search,
  Plus,
  MessagesSquare,
  FileStack,
  FolderKanban,
  Share2,
  Brain,
  Sparkles,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  Settings,
  Moon,
  Globe,
  HelpCircle,
  LogOut,
  Bell,
  EyeOff,
  UserPlus,
  ExternalLink,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useAuth, type UserRole } from "@/components/auth/auth-context";

const ALL_INTELLIGENCE_HREFS = [
  "/",
  "/copilot",
  "/search",
  "/documents",
  "/graph",
  "/decision-eval",
  "/evaluation",
  "/observability",
];

// Role-based visibility mapping (All features unlocked except Super Admin exclusive routes)
const ROLE_ALLOWED_HREFS: Record<string, string[]> = {
  guest: ["/", "/copilot", "/search", "/documents"],
  customer: ALL_INTELLIGENCE_HREFS,
  analyst: ALL_INTELLIGENCE_HREFS,
  admin: ALL_INTELLIGENCE_HREFS,
  super_admin: [...ALL_INTELLIGENCE_HREFS, "/learning", "/admin"],
};

const PRIMARY_NAV = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Copilot", href: "/copilot", icon: MessagesSquare },
  { label: "Search", href: "/search", icon: Search },
  { label: "Documents", href: "/documents", icon: FileStack },
];

const ADVANCED_NAV = [
  { label: "Knowledge Graph", href: "/graph", icon: Share2 },
  { label: "Decision Intelligence", href: "/decision-eval", icon: Brain },
  { label: "Diagnostics", href: "/observability", icon: Gauge },
  { label: "Evaluation", href: "/evaluation", icon: ClipboardCheck },
  { label: "Self-Learning", href: "/learning", icon: Sparkles },
  { label: "Platform Admin", href: "/admin", icon: ShieldCheck },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    role,
    isAuthenticated,
    openAuthModal,
    logout,
    refreshUser,
    isIncognito,
    toggleIncognito,
  } = useAuth();

  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close account menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const allowedHrefs = ROLE_ALLOWED_HREFS[role] || ROLE_ALLOWED_HREFS.customer;

  // Filter primary and advanced items by user role
  const visiblePrimary = PRIMARY_NAV.filter((item) => allowedHrefs.includes(item.href));
  const visibleAdvanced = ADVANCED_NAV.filter((item) => allowedHrefs.includes(item.href));

  // Determine user avatar initial and display strings
  const displayName = user?.name || (isAuthenticated ? user?.email?.split("@")[0] : "Guest Explorer");
  const displayEmail = user?.email || "Browse institutional call reports";
  const userInitial = (displayName?.[0] || "V").toUpperCase();

  const planLabel =
    role === "super_admin"
      ? "Platform Lead · Super Admin"
      : isAuthenticated
      ? "Institutional Suite"
      : "Free Discovery";

  return (
    <>
      <aside
        className={cn(
          "hidden lg:flex shrink-0 flex-col bg-[#06080F] border-r border-white/[0.06] text-zinc-400 transition-all duration-200 select-none relative z-30",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        {/* Top Header: Brand Icon + Search & Toggle (Perplexity Style) */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-white/[0.06]">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Radar className="h-5 w-5 text-evidence shrink-0" strokeWidth={2} />
            {!isCollapsed && (
              <span className="font-display text-[15px] font-semibold text-white tracking-tight">
                Tathyx
              </span>
            )}
          </Link>

          {!isCollapsed && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => router.push("/search")}
                title="Search filings & sessions"
                className="p-1.5 rounded-lg hover:bg-white/[0.05] text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setIsCollapsed(true)}
                title="Collapse sidebar"
                className="p-1.5 rounded-lg hover:bg-white/[0.05] text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation List - Pure text with icon, hovering creates clean rounded highlight (Perplexity AI Style) */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {/* Primary Actions */}
          <div className="space-y-0.5">
            {visiblePrimary.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors",
                    active
                      ? "bg-white/[0.08] text-white font-medium"
                      : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active ? "text-white" : "text-zinc-400 group-hover:text-white"
                    )}
                    strokeWidth={active ? 2 : 1.75}
                  />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>

          {/* Collapsible Sessions / Vault Section (Perplexity Style Clean Text Links) */}
          {!isCollapsed && (
            <div className="pt-2 border-t border-white/[0.06]">
              <button
                onClick={() => setSessionsExpanded(!sessionsExpanded)}
                className="w-full flex items-center justify-between px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 hover:text-white transition-colors cursor-pointer"
              >
                <span>Recent Audits</span>
                {sessionsExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>

              {sessionsExpanded && (
                <div className="mt-1 space-y-0.5">
                  <Link
                    href="/copilot"
                    className="block px-3 py-1.5 rounded-lg text-[12px] text-zinc-400 hover:bg-white/[0.05] hover:text-white truncate transition-colors"
                  >
                    Apex Supplier Quality Q3
                  </Link>
                  <Link
                    href="/copilot"
                    className="block px-3 py-1.5 rounded-lg text-[12px] text-zinc-400 hover:bg-white/[0.05] hover:text-white truncate transition-colors"
                  >
                    Covenant Compliance 2026
                  </Link>
                  <Link
                    href="/copilot"
                    className="block px-3 py-1.5 rounded-lg text-[12px] text-zinc-400 hover:bg-white/[0.05] hover:text-white truncate transition-colors"
                  >
                    Quarterly Debt Trajectory
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Elevated Intelligence Section (Analyst / Admin / SuperAdmin) */}
          {!isCollapsed && visibleAdvanced.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06]">
              <p className="px-3 py-1 text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                Internal Intelligence
              </p>
              <div className="space-y-0.5">
                {visibleAdvanced.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors",
                        active
                          ? "bg-white/[0.08] text-white font-medium"
                          : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          active ? "text-white" : "text-zinc-400"
                        )}
                        strokeWidth={active ? 2 : 1.75}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Profile Bar & Popover Menu (Perplexity Style Clean Text Pill) */}
        <div className="relative p-2 pb-3 border-t border-white/[0.06] bg-[#06080F] z-40" ref={menuRef}>
          {/* Upward Floating Popover Menu */}
          {isAccountMenuOpen && (
            <div className="absolute bottom-16 left-2 right-2 w-72 rounded-2xl border border-[#233047] bg-[#0D121D] p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
              {/* Profile Card Header */}
              <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.06] mb-1">
                <div className="h-9 w-9 rounded-full bg-white/10 text-white font-semibold flex items-center justify-center text-sm shrink-0">
                  {userInitial}
                </div>
                <div className="truncate leading-tight">
                  <p className="text-[13px] font-semibold text-white truncate">{displayName}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{displayEmail}</p>
                </div>
              </div>

              {/* Menu List */}
              <div className="space-y-0.5 text-[13px]">
                {/* Incognito / Privacy Toggle */}
                <div className="flex items-center justify-between px-3 py-2 rounded-xl text-zinc-300 hover:bg-white/[0.05] transition-colors">
                  <div className="flex items-center gap-2.5">
                    <EyeOff className={cn("h-4 w-4 transition-colors", isIncognito ? "text-evidence" : "text-zinc-400")} />
                    <span>Incognito mode</span>
                  </div>
                  <button
                    onClick={toggleIncognito}
                    className={cn(
                      "w-8 h-4.5 rounded-full p-0.5 transition-colors cursor-pointer",
                      isIncognito ? "bg-evidence" : "bg-white/20"
                    )}
                  >
                    <div
                      className={cn(
                        "w-3.5 h-3.5 rounded-full transition-transform",
                        isIncognito ? "translate-x-3.5 bg-black" : "translate-x-0 bg-white"
                      )}
                    />
                  </button>
                </div>

                {/* Switch / Add Account */}
                <button
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    openAuthModal("Switch or register institutional account");
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-zinc-300 hover:bg-white/[0.05] hover:text-white transition-colors text-left cursor-pointer"
                >
                  <UserPlus className="h-4 w-4 text-zinc-400" />
                  <span>Switch account</span>
                </button>

                {/* All Settings */}
                <button
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    setIsSettingsOpen(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-zinc-300 hover:bg-white/[0.05] hover:text-white transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Settings className="h-4 w-4 text-zinc-400" />
                    <span>All settings</span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500">⌘,</span>
                </button>

                {/* Appearance */}
                <div className="flex items-center justify-between px-3 py-2 rounded-xl text-zinc-300 hover:bg-white/[0.05] transition-colors">
                  <div className="flex items-center gap-2.5">
                    <Moon className="h-4 w-4 text-zinc-400" />
                    <span>Appearance</span>
                  </div>
                  <span className="text-[11px] text-zinc-400">Dark</span>
                </div>

                {/* Help */}
                <Link
                  href="/evaluation"
                  onClick={() => setIsAccountMenuOpen(false)}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-zinc-300 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <HelpCircle className="h-4 w-4 text-zinc-400" />
                    <span>Help & Docs</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                </Link>

                <div className="my-1 border-t border-white/[0.06]" />

                {/* Sign Out or Sign In */}
                {isAuthenticated ? (
                  <button
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors text-left cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign out</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      openAuthModal("Sign in to access your reports");
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white hover:bg-white/10 transition-colors text-left cursor-pointer font-medium"
                  >
                    <Radar className="h-4 w-4" />
                    <span>Sign in</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Trigger Button: User Pill at bottom of sidebar */}
          <div className="flex items-center justify-between gap-1">
            <button
              onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
              className={cn(
                "flex-1 flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.05] transition-colors cursor-pointer text-left",
                isAccountMenuOpen && "bg-white/[0.08]"
              )}
            >
              <div className="h-8 w-8 rounded-full bg-white/10 text-white font-medium flex items-center justify-center text-xs shrink-0">
                {userInitial}
              </div>
              {!isCollapsed && (
                <div className="truncate leading-tight flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white truncate">{displayName}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{planLabel}</p>
                </div>
              )}
              {!isCollapsed && <ChevronsUpDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />}
            </button>

            {!isCollapsed && (
              <button
                title="Notifications"
                className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors cursor-pointer shrink-0"
              >
                <Bell className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
          <div
            className="w-full max-w-lg rounded-2xl border border-[#233047] bg-[#0d121d]/95 backdrop-blur-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_30px_rgba(79,209,197,0.1)] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#1e293b] mb-4">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-evidence" />
                <h3 className="font-display text-base font-semibold text-white">Account Settings</h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[#64748b] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-[13px]">
              {/* Profile Card */}
              <div className="p-3.5 rounded-xl border border-evidence/20 bg-evidence/[0.03]">
                <p className="text-[11px] font-mono text-evidence uppercase mb-1">Current User</p>
                <p className="text-white font-medium">{displayName}</p>
                <p className="text-[#94a3b8] text-[12px]">{displayEmail}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="rounded bg-evidence/15 border border-evidence/30 px-2 py-0.5 font-mono text-[10px] font-bold text-evidence uppercase shadow-[0_0_6px_rgba(79,209,197,0.2)]">
                    Role: {role}
                  </span>
                  <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white">
                    {user?.orgName || "Apex Capital"}
                  </span>
                </div>
              </div>

              {/* Quick RBAC Switcher for Local Testing */}
              <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/[0.03]">
                <p className="text-[11px] font-mono text-primary uppercase font-bold mb-2">
                  ⚡ Quick Role Tester (Switch in 1-Click)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { r: "super_admin", email: "superadmin@tathyx.ai", label: "Super Admin" },
                    { r: "admin", email: "admin@tathyx.ai", label: "Org Admin" },
                    { r: "analyst", email: "analyst@tathyx.ai", label: "Credit Analyst" },
                    { r: "customer", email: "customer@tathyx.ai", label: "Customer" },
                  ].map((item) => (
                    <button
                      key={item.r}
                      onClick={async () => {
                        setIsSettingsOpen(false);
                        openAuthModal(`Switch to ${item.label} (${item.email})`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-[#233047] bg-[#141b2a] hover:bg-[#1a2337] hover:border-evidence/40 text-white text-[12px] text-left transition-colors cursor-pointer"
                    >
                      <span className="block font-medium">{item.label}</span>
                      <span className="block text-[10px] text-[#64748b] truncate">{item.email}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-xl bg-evidence/20 hover:bg-evidence/30 border border-evidence/30 text-white text-[12px] font-medium transition-colors cursor-pointer shadow-[0_0_10px_rgba(79,209,197,0.2)]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
