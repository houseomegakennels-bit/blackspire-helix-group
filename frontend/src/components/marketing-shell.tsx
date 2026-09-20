import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { publicContact } from "@/lib/public-contact";
import { MarketingNav } from "@/components/marketing-nav";

export function MarketingShell({
  children,
  watermarkLogoSrc,
  themeStyle,
}: {
  children: ReactNode;
  /**
   * When set, the full-viewport background watermark shows this division
   * logo instead of the parent BLACKSPIRE HELIX mark. Division pages should
   * pass their own logo here rather than layering a second watermark, so the
   * division logo reads cleanly instead of fighting the parent one.
   */
  watermarkLogoSrc?: string;
  /**
   * Division --project-* tokens (from divisionThemeStyle). When set, the
   * shell background, top glow, and header underline adopt the division's
   * logo palette instead of the parent blue. Defaults preserve the parent.
   */
  themeStyle?: CSSProperties;
}) {
  const isDivisionWatermark = Boolean(watermarkLogoSrc);
  const watermarkSrc =
    watermarkLogoSrc ?? "/brand/blackspire-helix-group-logo-fit.png";
  return (
    <main
      className={`luxury-shell min-h-screen text-foreground ${isDivisionWatermark ? "luxury-shell-division" : "public-marketing"}`}
      style={themeStyle}
    >
      <div className="luxury-orbital-field" aria-hidden="true">
        <span className="luxury-orbital-ring luxury-orbital-ring-a" />
        <span className="luxury-orbital-ring luxury-orbital-ring-b" />
        <span className="luxury-orbital-ring luxury-orbital-ring-c" />
      </div>
      <div
        className={`luxury-watermark ${isDivisionWatermark ? "luxury-watermark-division" : ""}`}
        aria-hidden="true"
      >
        <Image
          src={watermarkSrc}
          alt=""
          width={isDivisionWatermark ? 1254 : 1792}
          height={isDivisionWatermark ? 1254 : 1024}
          aria-hidden="true"
          className="luxury-watermark-img"
        />
      </div>
      <div className="luxury-scroll-rail" aria-hidden="true" />
      <header className="luxury-header sticky top-0 z-40 border-b border-[var(--line)] bg-[hsl(0_0%_3%/.72)] backdrop-blur-2xl">
        <div className="luxury-header-inner mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:py-4 lg:px-6">
          <Link
            href="/"
            className="min-w-0 max-w-[270px] transition duration-300 hover:opacity-95"
          >
            <div className="relative h-[80px] w-[138px] overflow-hidden sm:h-[94px] sm:w-[164px]">
              <Image
                src="/brand/blackspire-helix-group-logo-fit.png"
                alt="BLACKSPIRE HELIX GROUP logo"
                width={1792}
                height={1024}
                priority
                className="h-full w-full object-contain"
              />
            </div>
          </Link>

          <MarketingNav />
        </div>
      </header>

      {children}

      <footer className="public-footer">
        <div>
          <p className="public-eyebrow">BLACKSPIRE HELIX GROUP</p>
          <h2>We take the busy out of business.</h2>
          <p>
            Practical automation, websites, and apps built around your business.
          </p>
        </div>
        <div className="public-footer-links">
          <a href={publicContact.emailHref}>{publicContact.email}</a>
          <a href={publicContact.phoneHref}>{publicContact.phone}</a>
          <Link href="/ecosystem">Explore our products</Link>
          <Link href="/workspaces">Client access</Link>
        </div>
      </footer>
    </main>
  );
}
