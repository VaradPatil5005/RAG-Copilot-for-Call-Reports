import {
  LayoutDashboard,
  FileStack,
  MessagesSquare,
  Search,
  Share2,
  ClipboardCheck,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/",
    icon: LayoutDashboard,
    description: "Command-center dashboard",
  },
  {
    label: "Documents",
    href: "/documents",
    icon: FileStack,
    description: "Ingestion pipeline & document library",
  },
  {
    label: "Copilot",
    href: "/copilot",
    icon: MessagesSquare,
    description: "Grounded AI question answering",
  },
  {
    label: "Search",
    href: "/search",
    icon: Search,
    description: "Hybrid lexical + semantic search",
  },
  {
    label: "Knowledge Graph",
    href: "/graph",
    icon: Share2,
    description: "Cross-document entity relationships",
  },
  {
    label: "Evaluation",
    href: "/evaluation",
    icon: ClipboardCheck,
    description: "Retrieval & generation benchmark",
  },
  {
    label: "Admin",
    href: "/admin",
    icon: ShieldCheck,
    description: "Security, health & observability",
  },
];
