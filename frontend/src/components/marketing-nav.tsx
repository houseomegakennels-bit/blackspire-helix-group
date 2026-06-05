"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { href: string; label: string };

export function MarketingNav({ items }: { items: NavItem[] }) {
  const [openPathname, setOpenPathname] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openPathname === pathname;

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/* Desktop / tablet inline nav */}
      <nav className="hidden flex-wrap items-center justify-end gap-2 md:flex">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="luxury-nav-link rounded-full border border-[var(--line)] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Mobile hamburger trigger */}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpenPathname(open ? null : pathname)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white md:hidden"
      >
        <span className="relative block h-3.5 w-5" aria-hidden="true">
          <span
            className={`absolute left-0 block h-0.5 w-5 bg-current transition-transform duration-300 ${
              open ? "top-1.5 rotate-45" : "top-0"
            }`}
          />
          <span
            className={`absolute left-0 top-1.5 block h-0.5 w-5 bg-current transition-opacity duration-200 ${
              open ? "opacity-0" : "opacity-100"
            }`}
          />
          <span
            className={`absolute left-0 block h-0.5 w-5 bg-current transition-transform duration-300 ${
              open ? "top-1.5 -rotate-45" : "top-3"
            }`}
          />
        </span>
      </button>

      {/* Mobile sheet */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpenPathname(null)}
            className="absolute inset-0 bg-[hsl(0_0%_0%/.72)] backdrop-blur-sm"
          />
          <nav className="luxury-mobile-sheet absolute right-3 top-3 left-3 grid gap-2 rounded-[24px] border border-[var(--line-strong)] bg-[hsl(0_0%_4%/.97)] p-4 shadow-[0_30px_80px_hsl(0_0%_0%/.6)]">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpenPathname(null)}
                className="flex min-h-[48px] items-center rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_6%/.9)] px-4 text-sm uppercase tracking-[0.2em] text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
