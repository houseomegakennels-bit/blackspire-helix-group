import Image from "next/image";
import Link from "next/link";
import { CSSProperties, ReactNode } from "react";

import type { OperatorShellStatus } from "@/lib/buyer-engine-server";

const navItems = [
  { href: "/", label: "Marketing Site" },
  { href: "/workspace/buyer-engine", label: "Dashboard" },
  { href: "/auth", label: "Auth" },
  { href: "/searches/new", label: "New Search" },
  { href: "/searches", label: "Search Jobs" },
  { href: "/buyers", label: "Buyer Reports" },
  { href: "/workflows", label: "Workflows" },
  { href: "/admin", label: "Admin" },
  { href: "/admin/county-sources", label: "County Sources" },
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
  const divisionStyle: CSSProperties = {
    "--project-accent": "#FF8A00",
    "--project-glow": "rgba(255,138,0,0.35)",
    "--project-surface": "rgba(255,138,0,0.12)",
    "--project-edge": "rgba(255,193,99,0.42)",
  } as CSSProperties;

  return (
    <main
      style={divisionStyle}
      className="theme-buyer-engine min-h-screen bg-[radial-gradient(circle_at_top,hsl(31_100%_34%/.16),transparent_30%),radial-gradient(circle_at_80%_12%,hsl(33_100%_50%/.06),transparent_26%),linear-gradient(180deg,hsl(0_0%_1%)_0%,hsl(22_18%_3%)_24%,hsl(14_22%_4%)_100%)] text-foreground"
    >
      <div className="mx-auto grid min-h-screen max-w-[1700px] gap-6 px-4 py-4 lg:grid-cols-[290px_minmax(0,1fr)] lg:px-6">
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

          <nav className="mt-5 space-y-2">
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

          <div className="brand-card mt-6 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--gold)]">
              System Focus
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">
              Wake land runs are moving through app-server prefetch before n8n scoring. The next level is a fully theatrical operator view with airtight audit trails and sharper decision framing.
            </p>
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
            <h2 className="brand-accent-text mt-3 text-4xl font-semibold lg:text-5xl">{title}</h2>
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
    active: "border-[var(--line-strong)] bg-[hsl(33_100%_50%/.14)] text-[var(--gold-soft)]",
    inactive: "border-[hsl(28_16%_40%/.45)] bg-[hsl(0_0%_100%/.02)] text-[var(--copy-soft)]",
    good: "border-[hsl(40_100%_72%/.45)] bg-[hsl(38_100%_54%/.12)] text-[var(--gold-soft)]",
    warn: "border-[hsl(30_100%_48%/.45)] bg-[hsl(28_100%_40%/.12)] text-[var(--gold)]",
    neutral: "border-[var(--line)] bg-[hsl(0_0%_100%/.03)] text-[var(--copy-soft)]",
    bad: "border-[hsl(16_100%_50%/.45)] bg-[hsl(16_100%_44%/.1)] text-[hsl(22_100%_72%)]",
  } as const;

  return (
    <span className={`inline-flex rounded-[999px] border px-2 py-1 text-[11px] uppercase tracking-[0.22em] ${tones[tone]}`}>
      {label}
    </span>
  );
}
