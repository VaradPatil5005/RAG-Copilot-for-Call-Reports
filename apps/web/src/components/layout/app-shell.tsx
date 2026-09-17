import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0A0D14]">
      <Sidebar />
      <div className="flex flex-1 flex-col h-full min-w-0 overflow-hidden">
        <main className="flex-1 h-full min-h-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
