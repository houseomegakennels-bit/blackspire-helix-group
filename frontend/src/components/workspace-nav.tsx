"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Consistent cross-workspace nav so Sentinel and every engine are reachable from
// any workspace — navigation stays familiar regardless of where you are.
const LINKS: Array<{ label: string; href: string; match: string; accent?: boolean }> = [
  { label: "Books", href: "/books", match: "/books" },
  { label: "Book Studio", href: "/studio/books", match: "/studio/books" },
  { label: "Start Here", href: "/beta", match: "/beta", accent: true },
  { label: "Sentinel", href: "/workspace/sentinel", match: "/workspace/sentinel", accent: true },
  { label: "Properties", href: "/workspace/property", match: "/workspace/property" },
  { label: "Harvester", href: "/workspace/harvester", match: "/workspace/harvester" },
  { label: "Seller", href: "/workspace/seller-engine", match: "/seller-engine" },
  { label: "Nexus", href: "/workspace/nexus", match: "/workspace/nexus" },
  { label: "Deal", href: "/workspace/deal-engine", match: "/workspace/deal-engine" },
  { label: "Buyer", href: "/workspace/buyer-engine", match: "/workspace/buyer-engine" },
  { label: "Helix Trade", href: "/workspace/helix-trade-command", match: "/workspace/helix-trade-command", accent: true },
];

export function WorkspaceNav() {
  const pathname = usePathname() ?? "";
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = railRef.current?.querySelector<HTMLElement>("[data-active='true']");
    current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  // The property shell already provides everyday navigation. Keep the other
  // workspaces available without stacking another full navigation rail above it.
  if (pathname === "/workspace/deal-engine" || pathname.startsWith("/workspace/deal-engine/")) {
    return (
      <nav aria-label="Blackspire workspaces" className="sticky top-0 z-30 border-b border-white/15 bg-[#0b1217] text-white">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link href="/workspaces" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">All workspaces</Link>
          <details className="relative">
            <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2">Other workspaces</summary>
            <div className="absolute right-0 z-40 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-white/20 bg-[#142129] p-2 shadow-xl">
              {LINKS.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.match ? "page" : undefined} className="flex min-h-11 items-center rounded-lg px-3 py-3 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2">{link.label}</Link>)}
            </div>
          </details>
        </div>
      </nav>
    );
  }

  return (
    <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-black/70 backdrop-blur">
      <div ref={railRef} className="mx-auto flex max-w-[1480px] items-center gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:px-6">
        <Link href="/workspaces" className="mr-2 shrink-0 rounded-full border border-transparent px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-[#5eead4]">
          Blackspire
        </Link>
        {LINKS.map((link) => {
          const active = pathname === link.match || pathname.startsWith(`${link.match}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              data-active={active ? "true" : "false"}
              className="shrink-0 rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.14em] transition sm:text-xs sm:tracking-[0.16em]"
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
