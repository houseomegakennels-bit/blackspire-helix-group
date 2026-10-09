"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

const links = [
  ["Home", "/"],
  ["Services", "/services"],
  ["Demos", "/demos"],
  ["Products", "/ecosystem"],
  ["Books", "/books"],
  ["About", "/about"],
] as const;

export function MarketingNav() {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const open = openPath === pathname;
  return (
    <div className="public-navigation" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        setOpenPath(null);
        toggle.current?.focus();
      }
    }}>
      <button ref={toggle} type="button" className="public-menu-toggle"
        aria-expanded={open} aria-controls="public-navigation-links"
        onClick={() => setOpenPath(open ? null : pathname)}>
        {open ? "Close menu" : "Menu"}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <nav id="public-navigation-links" aria-label="Main navigation"
        className="public-nav" data-open={open}>
        {links.map(([label, href]) => (
          <Link key={href} href={href} onClick={() => setOpenPath(null)}
            aria-current={pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) ? "page" : undefined}>
            {label}
          </Link>
        ))}
        <Link href="/workspaces" className="public-client-link" onClick={() => setOpenPath(null)}
          aria-current={pathname === "/workspaces" || pathname.startsWith("/workspaces/") ? "page" : undefined}>
          Client access
        </Link>
        <Link href="/auth" onClick={() => setOpenPath(null)}>Sign in</Link>
        <Link href="/contact" className="public-button" onClick={() => setOpenPath(null)}
          aria-current={pathname === "/contact" ? "page" : undefined}>
          Let’s talk
        </Link>
      </nav>
    </div>
  );
}
