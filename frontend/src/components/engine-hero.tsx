import Link from "next/link";

export function EngineHero({
  title,
  subtitle,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  subtitle: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
}) {
  return (
    <section className="brand-panel overflow-hidden px-6 py-8 lg:px-8">
      <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Real Estate Intelligence</p>
      <h2 className="brand-display mt-3 text-4xl leading-tight text-white lg:text-5xl">{title}</h2>
      <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--copy-soft)]">{subtitle}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={primaryHref} className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
          {primaryLabel}
        </Link>
        <Link href={secondaryHref} className="brand-button inline-flex px-6 py-4 text-sm uppercase tracking-[0.18em] transition">
          {secondaryLabel}
        </Link>
      </div>
    </section>
  );
}
