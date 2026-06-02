import Image from "next/image";

export function EcosystemMark({
  name,
  monogram,
  logoSrc,
  variant = "framed",
  logoMaxWidthClass = "max-w-[260px]",
  logoMaxHeightClass = "max-h-[140px]",
  logoStageClass,
}: {
  name: string;
  monogram: string;
  logoSrc?: string;
  variant?: "framed" | "bare" | "hero";
  logoMaxWidthClass?: string;
  logoMaxHeightClass?: string;
  logoStageClass?: string;
}) {
  const frameClass =
    variant === "bare"
      ? "flex min-h-[98px] w-full items-center justify-center px-1 py-1"
      : variant === "hero"
        ? "brand-card flex min-h-[208px] w-full items-center justify-center overflow-hidden px-4 py-4"
        : "brand-card flex min-h-[178px] w-full items-center justify-center overflow-hidden px-3 py-3";

  const defaultStageClass =
    variant === "bare"
      ? "h-[86px]"
      : variant === "hero"
        ? "h-[176px]"
        : "h-[148px]";

  if (logoSrc) {
    return (
      <div className={frameClass}>
        <div
          className={`relative mx-auto w-full overflow-hidden ${logoMaxWidthClass} ${logoMaxHeightClass} ${logoStageClass ?? defaultStageClass}`}
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
