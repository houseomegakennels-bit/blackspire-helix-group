import Image from "next/image";

export function HarvesterIdentity({
  branding,
  size = "default",
}: {
  branding: {
    logoPath: string;
    markPath: string;
    logoAvailable: boolean;
    markAvailable: boolean;
  };
  size?: "default" | "compact" | "hero";
}) {
  const logoWidth = size === "hero" ? 340 : size === "compact" ? 170 : 240;
  const logoHeight = size === "hero" ? 220 : size === "compact" ? 94 : 150;
  const frameClass =
    size === "hero"
      ? "min-h-[220px] rounded-[30px] p-8"
      : size === "compact"
        ? "min-h-[88px] rounded-[20px] px-4 py-3"
        : "min-h-[144px] rounded-[24px] p-5";

  return (
    <div className={`harvester-logo-frame ${frameClass}`}>
      {branding.logoAvailable ? (
        <Image
          src={branding.logoPath}
          alt="Harvester logo"
          width={logoWidth}
          height={logoHeight}
          className="mx-auto h-auto max-h-[180px] w-auto object-contain"
          priority={size === "hero"}
        />
      ) : (
        <div className="mx-auto flex max-w-[280px] items-center gap-4">
          <div className="harvester-emblem">
            <div className="harvester-emblem-ring" />
            <div className="harvester-emblem-stalk" />
            <div className="harvester-emblem-helix" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.4em] text-[var(--copy-muted)]">Blackspire Project</div>
            <div className="mt-2 text-2xl font-black tracking-[0.18em] text-white sm:text-3xl">HARVESTER</div>
            <div className="mt-2 text-xs uppercase tracking-[0.26em] text-[var(--gold-soft)]">Opportunity Acquisition Intelligence</div>
          </div>
        </div>
      )}
    </div>
  );
}
