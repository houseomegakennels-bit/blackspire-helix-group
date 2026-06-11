import Image from "next/image";
import Link from "next/link";
import { ReactNode } from "react";

import { DivisionWatermark } from "@/components/division-watermark";
import { RealEstateWorkflowRail } from "@/components/real-estate-workflow-rail";
import { brandAssets } from "@/lib/brand-assets";
import type { OperatorShellStatus } from "@/lib/buyer-engine-server";

const navItems = [
  { href: "/", label: "Marketing Site" },
  { href: "/workspace/buyer-engine", label: "Dashboard" },
  { href: "/workspace/deal-engine", label: "Deal Engine" },
  { href: "/seller-engine", label: "Seller Engine" },
  { href: "/auth", label: "Auth" },
  { href: "/searches/new", label: "New Search" },
  { href: "/workspace/buyer-engine/reverse-search", label: "Reverse Search" },
  { href: "/searches", label: "Search Jobs" },
  { href: "/buyers", label: "Buyer Reports" },
  { href: "/workflows", label: "Workflows" },
  { href: "/admin", label: "Admin" },
  { href: "/admin/county-sources", label: "County Sources" },
  { href: "/admin/buyer-groups", label: "Buyer Groups" },
];

export function BuyerShell({
  eyebrow,
  title,
  description,
  children,
  operatorStatus,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  operatorStatus?: OperatorShellStatus | null;
}) {
  return (
    <main
      className="theme-buyer-engine relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_16%_-2%,hsl(32_100%_46%/.24),transparent_42%),radial-gradient(circle_at_86%_8%,hsl(20_94%_48%/.16),transparent_38%),radial-gradient(circle_at_50%_122%,hsl(28_100%_40%/.16),transparent_54%),linear-gradient(180deg,hsl(24_30%_4%)_0%,hsl(18_26%_3%)_46%,hsl(14_30%_4%)_100%)] text-foreground"
    >
      <DivisionWatermark logoSrc={brandAssets.buyerEngine.logo} />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1700px] gap-6 px-4 py-4 lg:grid-cols-[290px_minmax(0,1fr)] lg:px-6">
        <aside className="brand-panel h-fit overflow-hidden p-5 lg:sticky lg:top-4">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-32 rounded-b-[40px] bg-[radial-gradient(circle_at_top,hsl(34_100%_62%/.12),transparent_74%)]" />
          <div className="space-y-4 border-b border-[var(--line)] pb-5">
            <div className="brand-card overflow-hidden p-3">
              <Image
                src="/brand/blackspire-buyer-engine-logo.png"
                alt="Blackspire Buyer Engine logo"
                width={768}
                height={1365}
                priority
                className="h-auto w-full object-contain"
              />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.5em] text-[var(--gold-soft)]">
                Blackspire Helix Group Product
              </p>
              <h1 className="brand-display text-2xl leading-tight text-white">Command Surface</h1>
              <div className="flex items-center gap-3">
                <div className="brand-hairline flex-1" />
                <div className="brand-target" />
                <div className="brand-hairline flex-1" />
              </div>
              <p className="text-sm leading-6 text-[var(--copy-soft)]">
                A premium operator deck for finding, scoring, and activating real-estate buyers across the Blackspire Helix Group ecosystem.
              </p>
            </div>
          </div>

          <nav className="mt-5 hidden space-y-2 lg:block">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-[16px] border border-[var(--line)] bg-[linear-gradient(180deg,hsl(0_0%_6%/.92),hsl(18_22%_9%/.92))] px-4 py-3 text-sm uppercase tracking-[0.18em] text-[var(--copy-soft)] transition hover:-translate-y-[1px] hover:border-[var(--line-strong)] hover:text-white hover:shadow-[0_16px_30px_hsl(0_0%_0%/.28)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="brand-card mt-6 hidden p-4 lg:block">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--gold)]">
              System Focus
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Wake land runs are moving through app-server prefetch before n8n scoring. The next level is a fully theatrical operator view with airtight audit trails and sharper decision framing.
            </p>
          </div>
          <div className="hidden lg:block">
            <RealEstateWorkflowRail active="buyer" compact />
          </div>

          {operatorStatus ? (
            <div className="brand-card mt-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  tone={operatorStatus.authConfigured ? "good" : "bad"}
                  label={operatorStatus.authConfigured ? "auth ready" : "auth env missing"}
                />
                <StatusPill
                  tone={operatorStatus.signedIn ? "good" : operatorStatus.bootstrapRequired ? "warn" : "neutral"}
                  label={
                    operatorStatus.signedIn
                      ? "operator signed in"
                      : operatorStatus.bootstrapRequired
                        ? "bootstrap mode"
                        : "sign-in required"
                  }
                />
                {operatorStatus.usingFallback ? <StatusPill tone="warn" label="fallback bridge" /> : null}
                {operatorStatus.isAdmin ? <StatusPill tone="good" label="admin" /> : null}
              </div>
              <div className="mt-3 text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">
                Active Operator
              </div>
              <div className="mt-2 text-sm text-white">
                {operatorStatus.operatorEmail ?? (operatorStatus.signedIn ? "Signed-in operator" : operatorStatus.usingFallback ? "Bootstrap fallback identity" : "No active operator session")}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[var(--copy-muted)] break-all">
                {operatorStatus.operatorId ?? "No operator id loaded"}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="space-y-6">
          <header className="brand-panel overflow-hidden px-6 py-6">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-[34%] bg-[radial-gradient(circle_at_center,hsl(35_100%_66%/.08),transparent_72%)]" />
            <div className="flex items-center gap-3">
              <p className="text-xs uppercase tracking-[0.48em] text-[var(--gold-soft)]">
                {eyebrow}
              </p>
              <div className="brand-target h-[14px] w-[14px]" />
            </div>
            <h2 className="brand-accent-text mt-3 text-2xl font-semibold sm:text-3xl lg:text-4xl xl:text-5xl">{title}</h2>
            <div className="mt-4 brand-hairline" />
            <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">{description}</p>
          </header>

          {children}
        </section>
      </div>
    </main>
  );
}

export function Panel({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="brand-panel px-5 py-5">
      <div className="mb-5 space-y-2">
        <p className="text-xs uppercase tracking-[0.36em] text-[var(--gold)]">
          {eyebrow}
        </p>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="max-w-4xl text-sm leading-6 text-[var(--copy-soft)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="brand-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">
        {label}
      </div>
      <div className="brand-accent-text mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs leading-5 text-[var(--copy-soft)]">{detail}</div>
    </div>
  );
}

export function StatusPill({
  tone,
  label,
}: {
  tone: "active" | "inactive" | "good" | "warn" | "neutral" | "bad";
  label: string;
}) {
  const tones = {
    active: "status-pill-active",
    inactive: "status-pill-inactive",
    good: "status-pill-good",
    warn: "status-pill-warn",
    neutral: "status-pill-neutral",
    bad: "status-pill-bad",
  } as const;

  return (
    <span className={`status-pill ${tones[tone]}`}>
      {label}
    </span>
  );
}
