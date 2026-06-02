import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle, LiveDot } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { BellRing, Flame, HeartPulse, TrendingUp, AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_app/alerts")({ component: AlertsPage });

type SharpSignal = { id?: string; game_id?: string; signal_type?: string; direction?: string; magnitude?: number; description?: string; sport?: string; away_team?: string; home_team?: string; created_at?: string };
type Injury = { id?: string; player_id?: string; player?: { full_name?: string; position?: string; team?: { abbreviation?: string } }; status?: string; injury_type?: string; notes?: string; updated_at?: string };

const TONE: Record<string, string> = {
  STEAM_MOVE: "crimson", REVERSE_LINE: "helix", SHARP_ACTION: "neon",
  PUBLIC_FADE: "amber", LINE_FREEZE: "neon", default: "neon",
};

function timeAgo(ts?: string) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

function AlertsPage() {
  const [sharp, setSharp] = useState<SharpSignal[]>([]);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(0);

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/dashboard`)
      .then(r => r.json())
      .then(d => {
        setSharp(d.sharpFeed ?? []);
        setInjuries(d.injuries ?? []);
        setLastUpdate(Date.now());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); const id = window.setInterval(load, 60_000); return () => window.clearInterval(id); }, []);

  const injurySeverity = (status?: string) => {
    const s = (status ?? "").toLowerCase();
    if (s.includes("out")) return "crimson";
    if (s.includes("doubtful") || s.includes("questionable")) return "amber";
    return "neon";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionTitle eyebrow="Alerts" title="Alerts Feed" description="Sharp money, line movement, and injury alerts — refreshed every 60s." />
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border/30 rounded-lg px-3 py-1.5 hover:bg-muted/20 transition disabled:opacity-40">
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LiveDot /> Live feed · last updated {lastUpdate ? timeAgo(new Date(lastUpdate).toISOString()) : "—"}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sharp Money Feed */}
        <Panel>
          <PanelHeader
            title="Sharp Money Feed"
            subtitle={`${sharp.length} signals`}
            icon={<Flame className="size-4" />}
            right={<Pill tone="crimson">SHARP</Pill>}
          />
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_,i) => <div key={i} className="h-14 rounded-lg shimmer bg-muted/30" />)}</div>
          ) : sharp.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No sharp signals in the last hour</div>
          ) : (
            <div className="space-y-2">
              {sharp.map((s, i) => {
                const tone = (TONE[s.signal_type ?? ""] ?? TONE.default) as "neon"|"helix"|"crimson"|"emerald";
                return (
                  <div key={s.id ?? i} className="flex items-start gap-3 glass rounded-xl p-3">
                    <div className={`size-2 rounded-full mt-1.5 shrink-0 ${tone === "crimson" ? "bg-crimson" : tone === "helix" ? "bg-helix" : "bg-neon"} animate-pulse`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Pill tone={tone} className="text-[10px]">{s.signal_type?.replace(/_/g," ")}</Pill>
                        {s.sport && <span className="text-[10px] text-muted-foreground">{s.sport}</span>}
                        {s.magnitude != null && <span className="text-[10px] text-muted-foreground">Mag {s.magnitude.toFixed(1)}</span>}
                      </div>
                      <div className="mt-1 text-xs font-medium truncate">
                        {s.away_team && s.home_team ? `${s.away_team} @ ${s.home_team}` : (s.description ?? "Signal detected")}
                      </div>
                      {s.description && s.away_team && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{s.description}</div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(s.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Injury Alerts */}
        <Panel>
          <PanelHeader
            title="Injury Alerts"
            subtitle={`${injuries.length} active`}
            icon={<HeartPulse className="size-4" />}
            right={<Pill tone="crimson">ACTIVE</Pill>}
          />
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_,i) => <div key={i} className="h-14 rounded-lg shimmer bg-muted/30" />)}</div>
          ) : injuries.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No active injuries tracked</div>
          ) : (
            <div className="space-y-2">
              {injuries.map((inj, i) => {
                const tone = injurySeverity(inj.status) as "neon"|"crimson"|"amber";
                const name = inj.player?.full_name ?? `Player ${inj.player_id?.slice(0,6)}`;
                const team = inj.player?.team?.abbreviation ?? "";
                const pos = inj.player?.position ?? "";
                return (
                  <div key={inj.id ?? i} className="flex items-start gap-3 glass rounded-xl p-3">
                    <AlertTriangle className={`size-4 mt-0.5 shrink-0 ${tone === "crimson" ? "text-crimson" : tone === "amber" ? "text-amber-400" : "text-neon"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">{name}</span>
                        {team && <span className="text-[10px] text-muted-foreground">{team}{pos ? ` · ${pos}` : ""}</span>}
                        <Pill tone={tone} className="text-[10px]">{inj.status ?? "Unknown"}</Pill>
                      </div>
                      {inj.injury_type && <div className="text-[11px] text-muted-foreground mt-0.5">{inj.injury_type}</div>}
                      {inj.notes && <div className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-1">{inj.notes}</div>}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(inj.updated_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* Line Movement Banner */}
      <Panel className="!p-4">
        <div className="flex items-center gap-3">
          <TrendingUp className="size-5 text-emerald" />
          <div>
            <div className="text-sm font-semibold">Line Movement Tracking</div>
            <div className="text-xs text-muted-foreground mt-0.5">Opening vs current line deltas — available when odds sync runs. Check Admin to trigger a sync.</div>
          </div>
          <Pill tone="neon" className="ml-auto">Soon</Pill>
        </div>
      </Panel>
    </div>
  );
}