import { cn } from "@/lib/utils";
import type { ReactNode, HTMLAttributes } from "react";

export function Panel({ className, children, glow, ...rest }: HTMLAttributes<HTMLDivElement> & { glow?: "neon" | "helix" | "crimson" }) {
  return (
    <div {...rest} className={cn("glass rounded-2xl p-5 relative overflow-hidden transition-all", glow === "neon" && "glow-neon", glow === "helix" && "glow-helix", glow === "crimson" && "glow-crimson", className)}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, subtitle, right, icon }: { title: string; subtitle?: string; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="mt-0.5 text-primary">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, delta, accent }: { label: string; value: ReactNode; delta?: string; accent?: "neon" | "helix" | "emerald" | "crimson" | "amber" }) {
  const tone = { neon: "text-primary", helix: "text-accent", emerald: "text-emerald", crimson: "text-crimson", amber: "text-amber" }[accent || "neon"];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className={cn("font-mono-display text-2xl font-medium", tone)}>{value}</span>
      {delta && <span className="text-xs text-muted-foreground">{delta}</span>}
    </div>
  );
}

export function Pill({ children, tone = "neon", className }: { children: ReactNode; tone?: "neon" | "helix" | "emerald" | "crimson" | "amber" | "muted"; className?: string }) {
  const tones: Record<string, string> = {
    neon: "border-primary/40 text-primary bg-primary/10",
    helix: "border-accent/40 text-accent bg-accent/10",
    emerald: "border-emerald/40 text-emerald bg-emerald/10",
    crimson: "border-crimson/40 text-crimson bg-crimson/10",
    amber: "border-amber/40 text-amber bg-amber/10",
    muted: "border-border text-muted-foreground bg-muted/30",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium tracking-wide uppercase", tones[tone], className)}>
      {children}
    </span>
  );
}

export function SectionTitle({ eyebrow, title, description, right }: { eyebrow?: string; title: string; description?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        {eyebrow && <div className="text-[10px] uppercase tracking-[0.25em] text-primary mb-2">{eyebrow}</div>}
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {right}
    </div>
  );
}

export function LiveDot({ tone = "emerald" }: { tone?: "emerald" | "crimson" | "neon" }) {
  return <span className={cn("pulse-dot", tone === "crimson" && "crimson", tone === "neon" && "neon")} />;
}

export function SkeletonLine({ w = "full" }: { w?: string }) {
  return <div className={`h-3 w-${w} rounded shimmer bg-muted/30`} />;
}

export function ConfidenceMeter({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground"><span>{label}</span><span className="font-mono-display text-foreground">{value}%</span></div>}
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className="h-full bg-gradient-helix rounded-full transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
