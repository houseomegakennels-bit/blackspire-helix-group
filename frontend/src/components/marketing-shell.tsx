import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { EcosystemMark } from "@/components/ecosystem-mark";
import { MarketingNav } from "@/components/marketing-nav";
import { ecosystemProjects } from "@/lib/ecosystem";
import { siteNavSections } from "@/lib/site-structure";

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
  const watermarkSrc = watermarkLogoSrc ?? "/brand/blackspire-helix-group-logo-fit.png";
  return (
    <main
      className={`luxury-shell min-h-screen text-foreground ${isDivisionWatermark ? "luxury-shell-division" : ""}`}
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
          <Link href="/" className="min-w-0 max-w-[270px] transition duration-300 hover:opacity-95">
            <div className="relative h-[54px] w-[70px] overflow-hidden sm:h-[74px] sm:w-[96px]">
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

          <MarketingNav sections={siteNavSections} />
        </div>
      </header>

      {children}

      <footer className="luxury-footer border-t border-[var(--line)] bg-[hsl(0_0%_2%/.95)]">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-12 lg:grid-cols-[1.2fr_0.8fr] lg:px-6">
          <div className="scroll-reveal space-y-4">
            <div className="relative h-[78px] w-[160px] overflow-hidden sm:h-[118px] sm:w-[242px]">
              <Image
                src="/brand/blackspire-helix-group-logo-fit.png"
                alt="BLACKSPIRE HELIX GROUP logo"
                width={1792}
                height={1024}
                className="h-full w-full object-contain"
              />
            </div>
            <h2 className="brand-display max-w-2xl text-3xl leading-tight text-white">
              Building AI employees, workflow automations, and command surfaces for modern businesses.
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-[var(--copy-soft)]">
              The ecosystem is designed to show how one parent company can build specialized AI systems for different industries without losing brand coherence.
            </p>
          </div>

          <div className="scroll-reveal-left grid gap-3 sm:grid-cols-2" style={{ animationDelay: "0.1s" }}>
            {ecosystemProjects.map((project) => (
              <Link
                key={project.slug}
                href={project.href}
                className="ecosystem-footer-card scroll-reveal-scale rounded-[18px] px-4 py-4 transition hover:text-white"
                style={
                  {
                    "--project-accent": project.accent,
                    "--project-surface": project.surfaceTint,
                  } as CSSProperties
                }
              >
                <div className="mb-3">
                  <EcosystemMark
                    name={project.name}
                    monogram={project.monogram}
                    logoSrc={project.logoSrc}
                    variant="bare"
                    logoMaxWidthClass={project.logoMaxWidthClass}
                    logoMaxHeightClass={project.logoMaxHeightClass}
                    logoStageClass={project.logoStageClass}
                  />
                </div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
                  {project.role}
                </div>
                <div className="mt-2 text-base font-semibold text-white">{project.name}</div>
                <div className="mt-1 text-sm leading-6 text-[var(--copy-soft)]">{project.tagline}</div>
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
