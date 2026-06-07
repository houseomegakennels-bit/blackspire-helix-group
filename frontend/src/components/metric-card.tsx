export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="brand-card px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{label}</div>
      <div className="brand-accent-text mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-2 text-xs leading-5 text-[var(--copy-soft)]">{detail}</div>
    </div>
  );
}
