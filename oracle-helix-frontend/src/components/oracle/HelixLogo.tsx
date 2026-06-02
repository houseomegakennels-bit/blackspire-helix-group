import { cn } from "@/lib/utils";
import logoUrl from "@/assets/oracle-helix-logo.png";

export const ORACLE_HELIX_LOGO_URL = logoUrl;

export function HelixLogo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <div className={cn("relative inline-flex items-center justify-center shrink-0", className)} style={{ width: size, height: size }}>
      <img src={logoUrl} alt="Oracle Helix" width={size} height={size} className="object-contain drop-shadow-[0_0_18px_rgba(120,90,255,0.55)]" style={{ width: size, height: size }} loading="eager" />
    </div>
  );
}

export function HelixWordmark({ size = 18 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <HelixLogo size={size + 18} />
      <div className="flex flex-col leading-none">
        <span className="font-display font-semibold tracking-[0.18em] uppercase text-foreground" style={{ fontSize: size }}>
          Oracle <span className="text-gradient-helix">Helix</span>
        </span>
        <span className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground mt-1">Blackspire Helix Group</span>
      </div>
    </div>
  );
}

export function HelixWatermark({ className, opacity = 0.05, size = 720, position = "center" }: { className?: string; opacity?: number; size?: number; position?: "center" | "top-right" | "bottom-left" }) {
  const pos = position === "top-right" ? "top-[-12%] right-[-10%]" : position === "bottom-left" ? "bottom-[-15%] left-[-12%]" : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
  return (
    <div aria-hidden className={cn("pointer-events-none absolute z-0 select-none mix-blend-screen", pos, className)} style={{ width: size, height: size, opacity }}>
      <img src={logoUrl} alt="" className="w-full h-full object-contain animate-float" style={{ filter: "blur(0.5px) saturate(1.1)" }} />
    </div>
  );
}
