"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { SiteNavSection } from "@/lib/site-structure";

export function MarketingNav({ sections }: { sections: SiteNavSection[] }) {
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
      <nav className="hidden items-center justify-end gap-2 lg:flex">
        {sections.map((section) => (
          <div key={section.label} className="group relative">
            <Link
              href={section.href ?? section.items[0]?.href ?? "/"}
              className="luxury-nav-link inline-flex min-h-10 items-center rounded-full border border-[var(--line)] px-4 text-xs uppercase tracking-[0.18em] text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white"
            >
              {section.label}
            </Link>
            <div className="pointer-events-none absolute right-0 top-full z-50 w-[310px] translate-y-2 pt-2 opacity-0 transition group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
              <div className="rounded-[22px] border border-[var(--line-strong)] bg-[hsl(0_0%_4%/.97)] p-2 shadow-[0_24px_70px_hsl(0_0%_0%/.55)] backdrop-blur-2xl">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-[16px] px-3 py-3 transition hover:bg-[hsl(0_0%_100%/.05)]"
                  >
                    <span className="block text-sm font-semibold text-white">{item.label}</span>
                    {item.description ? (
                      <span className="mt-1 block text-xs leading-5 text-[var(--copy-soft)]">{item.description}</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        ))}
      </nav>

      {/* Mobile hamburger trigger */}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpenPathname(open ? null : pathname)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white lg:hidden"
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
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpenPathname(null)}
            className="absolute inset-0 bg-[hsl(0_0%_0%/.72)] backdrop-blur-sm"
          />
          <nav className="luxury-mobile-sheet absolute right-3 top-3 left-3 max-h-[calc(100vh-24px)] overflow-y-auto rounded-[24px] border border-[var(--line-strong)] bg-[hsl(0_0%_4%/.97)] p-4 shadow-[0_30px_80px_hsl(0_0%_0%/.6)]">
            {sections.map((section) => (
              <div key={section.label} className="border-b border-[var(--line)] py-3 last:border-b-0">
                <div className="px-2 text-[10px] uppercase tracking-[0.32em] text-[var(--copy-muted)]">
                  {section.label}
                </div>
                <div className="mt-2 grid gap-2">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpenPathname(null)}
                      className="flex min-h-[48px] flex-col justify-center rounded-[16px] border border-[var(--line)] bg-[hsl(0_0%_6%/.9)] px-4 py-3 text-sm text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white"
                    >
                      <span className="font-semibold text-white">{item.label}</span>
                      {item.description ? <span className="mt-1 text-xs leading-5">{item.description}</span> : null}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
