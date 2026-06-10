"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Consistent cross-workspace nav so Sentinel and every engine are reachable from
// any workspace — navigation stays familiar regardless of where you are.
const LINKS: Array<{ label: string; href: string; match: string; accent?: boolean }> = [
  { label: "Sentinel", href: "/workspace/sentinel", match: "/workspace/sentinel", accent: true },
  { label: "Properties", href: "/workspace/property", match: "/workspace/property" },
  { label: "Harvester", href: "/workspace/harvester", match: "/workspace/harvester" },
  { label: "Seller", href: "/seller-engine", match: "/seller-engine" },
  { label: "Nexus", href: "/workspace/nexus", match: "/workspace/nexus" },
  { label: "Deal", href: "/workspace/deal-engine", match: "/workspace/deal-engine" },
  { label: "Buyer", href: "/workspace/buyer-engine", match: "/workspace/buyer-engine" },
];

export function WorkspaceNav() {
  const pathname = usePathname() ?? "";

  return (
    <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-black/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1480px] items-center gap-1 overflow-x-auto px-3 py-2 lg:px-6">
        <Link href="/workspaces" className="mr-2 shrink-0 text-[10px] font-black uppercase tracking-[0.28em] text-[#5eead4]">
          Blackspire
        </Link>
        {LINKS.map((link) => {
          const active = pathname === link.match || pathname.startsWith(`${link.match}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.16em] transition"
              style={
                active
                  ? { color: "#5eead4", background: "rgba(45,212,191,0.14)", border: "1px solid #2dd4bf55" }
                  : link.accent
                    ? { color: "#5eead4", border: "1px solid transparent" }
                    : { color: "var(--copy-soft)", border: "1px solid transparent" }
              }
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
