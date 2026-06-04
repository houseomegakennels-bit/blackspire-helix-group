import Image from "next/image";

/**
 * Translucent division-logo watermark, in the spirit of the parent-logo
 * treatment on the marketing shell (.luxury-watermark), scoped to a division
 * surface so each workspace reads as its own brand.
 *
 * - Default ("deck"): absolute, scoped inside a `relative overflow-hidden`
 *   <main>; wrap the deck content in `relative z-10` so it sits above.
 * - `fixed` ("page"): fixed full-viewport at z-index -1, for MarketingShell
 *   pages that need a division watermark layered like the parent one.
 */
export function DivisionWatermark({
  logoSrc,
  fixed = false,
}: {
  logoSrc: string;
  fixed?: boolean;
}) {
  return (
    <div
      className={fixed ? "division-watermark" : "workspace-watermark"}
      aria-hidden="true"
    >
      <Image
        src={logoSrc}
        alt=""
        width={1200}
        height={1200}
        aria-hidden="true"
        className={fixed ? "division-watermark-img" : "workspace-watermark-img"}
      />
    </div>
  );
}
