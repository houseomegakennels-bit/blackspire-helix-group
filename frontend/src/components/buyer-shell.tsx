import Link from "next/link";
import { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/searches/new", label: "New Search" },
  { href: "/searches", label: "Search Jobs" },
  { href: "/buyers", label: "Buyer Reports" },
  { href: "/workflows", label: "Workflows" },
];

export function BuyerShell({
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
    <main className="min-h-screen bg-[hsl(222_20%_5%)] text-zinc-100">
      <div className="mx-auto grid min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="border border-white/10 bg-[hsl(222_18%_7%)] p-5">
          <div className="space-y-2 border-b border-white/10 pb-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[hsl(38_92%_55%)]">
              Blackspire
            </p>
            <h1 className="text-xl font-semibold text-white">
              Buyer Engine
            </h1>
            <p className="text-sm leading-6 text-zinc-400">
              Investor-grade intelligence surface for county sweeps, buyer dossiers, and workflow control.
            </p>
          </div>

          <nav className="mt-5 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block border border-white/10 bg-[hsl(222_14%_10%)] px-4 py-3 text-sm text-zinc-200 transition hover:border-[hsl(38_92%_55%/.35)] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-6 border border-[hsl(38_92%_55%/.25)] bg-[hsl(38_92%_55%/.08)] p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-[hsl(38_92%_55%)]">
              Immediate Risk
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-200">
              Wake County is still the fetch bottleneck. The next backend patch should page or slice those requests.
            </p>
          </div>
        </aside>

        <section className="space-y-6">
          <header className="border border-white/10 bg-[hsl(222_18%_7%)] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[hsl(38_92%_55%)]">
              {eyebrow}
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-white">{title}</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-400">
              {description}
            </p>
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
    <section className="border border-white/10 bg-[hsl(222_18%_7%)] px-5 py-5">
      <div className="mb-5 space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-[hsl(38_92%_55%)]">
          {eyebrow}
        </p>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="max-w-4xl text-sm leading-6 text-zinc-400">{description}</p>
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
    <div className="border border-white/10 bg-[hsl(222_14%_10%)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs leading-5 text-zinc-400">{detail}</div>
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
    active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    inactive: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
    good: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    neutral: "border-white/10 bg-white/5 text-zinc-300",
    bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  } as const;

  return (
    <span className={`inline-flex border px-2 py-1 text-[11px] uppercase tracking-[0.22em] ${tones[tone]}`}>
      {label}
    </span>
  );
}
