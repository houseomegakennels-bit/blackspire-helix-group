import Link from "next/link";

export function WorkspaceCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="brand-panel block p-5 transition hover:-translate-y-[1px] hover:border-[var(--line-strong)]">
      <div className="text-lg font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-6 text-[var(--copy-soft)]">{description}</div>
    </Link>
  );
}
