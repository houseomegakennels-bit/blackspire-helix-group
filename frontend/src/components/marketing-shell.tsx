import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { EcosystemMark } from "@/components/ecosystem-mark";
import { parentBrand, ecosystemProjects } from "@/lib/ecosystem";

const marketingNav = [
  { href: "/ecosystem", label: "Ecosystem" },
  { href: "/services", label: "Services" },
  { href: "/industries", label: "Industries" },
  { href: "/demos", label: "Demos" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function MarketingShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="luxury-shell min-h-screen text-foreground">
      <header className="luxury-header sticky top-0 z-40 border-b border-[var(--line)] bg-[hsl(0_0%_3%/.72)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6">
          <Link href="/" className="min-w-0 max-w-[270px] transition duration-300 hover:opacity-95">
            <div className="relative h-[74px] w-[96px] overflow-hidden">
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

          <nav className="flex flex-wrap items-center justify-end gap-2">
            {marketingNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="luxury-nav-link rounded-full border border-[var(--line)] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[var(--copy-soft)] transition hover:border-[var(--line-strong)] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/workspace/buyer-engine" className="brand-button inline-flex px-4 py-3 text-xs uppercase tracking-[0.2em] transition">
              Buyer Engine Workspace
            </Link>
          </nav>
        </div>
      </header>

      {children}

      <footer className="border-t border-[var(--line)] bg-[hsl(0_0%_2%/.95)]">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-12 lg:grid-cols-[1.2fr_0.8fr] lg:px-6">
          <div className="space-y-4">
            <div className="relative h-[118px] w-[242px] overflow-hidden">
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

          <div className="grid gap-3 sm:grid-cols-2">
            {ecosystemProjects.map((project) => (
              <Link
                key={project.slug}
                href={project.href}
                className="ecosystem-footer-card rounded-[18px] px-4 py-4 transition hover:text-white"
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
