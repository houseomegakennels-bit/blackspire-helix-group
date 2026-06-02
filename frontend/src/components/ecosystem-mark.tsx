import Image from "next/image";

export function EcosystemMark({
  name,
  monogram,
  logoSrc,
  variant = "framed",
  logoMaxWidthClass = "max-w-[260px]",
  logoMaxHeightClass = "max-h-[140px]",
}: {
  name: string;
  monogram: string;
  logoSrc?: string;
  variant?: "framed" | "bare" | "hero";
  logoMaxWidthClass?: string;
  logoMaxHeightClass?: string;
}) {
  const frameClass =
    variant === "bare"
      ? "flex min-h-[88px] items-center justify-center px-2 py-2"
      : variant === "hero"
        ? "brand-card flex min-h-[144px] items-center justify-center overflow-hidden px-5 py-6"
        : "brand-card flex min-h-[108px] items-center justify-center overflow-hidden px-4 py-5";

  // Height for the logo container per variant
  const logoContainerHeight =
    variant === "bare" ? 64 : variant === "hero" ? 120 : 96;

  if (logoSrc) {
    return (
      <div className={frameClass}>
        {/* Relative container with fixed height so `fill` + object-contain works correctly */}
        <div
          className={`relative mx-auto w-full overflow-hidden ${logoMaxWidthClass}`}
          style={{ height: `${logoContainerHeight}px` }}
        >
          <Image
            src={logoSrc}
            alt={`${name} logo`}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 180px, 300px"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={frameClass}>
      <div className="text-center">
        <div className="text-sm uppercase tracking-[0.5em] text-[var(--copy-muted)]">
          {monogram}
        </div>
        <div className="mt-3 text-lg font-semibold text-white">{name}</div>
      </div>
    </div>
  );
}
