import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle, LiveDot } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { Radar, Flame, CalendarDays, HeartPulse, TrendingUp, Activity, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_app/war-room")({ component: WarRoomPage });

type Game = { id?: string; sport?: string; home_team_name?: string; away_team_name?: string; home_team_abbr?: string; away_team_abbr?: string; scheduled_at?: string; status?: string; home_score?: number; away_score?: number };
type Signal = { id?: string; signal_type?: string; direction?: string; magnitude?: number; sport?: string; away_team?: string; home_team?: string; description?: string; created_at?: string };
type Injury = { id?: string; player?: { full_name?: string; position?: string; team?: { abbreviation?: string } }; status?: string; injury_type?: string };
type EV = { id?: string; sport?: string; player_name?: string; stat_type?: string; line?: number; edge?: number; sportsbook?: string };

function timeAgo(ts?: string) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m` : `${Math.floor(s/3600)}h`;
}

const SPORT_COLORS: Record<string, string> = { MLB: "neon", NBA: "helix", NHL: "emerald", WNBA: "crimson", NFL: "amber" };

function WarRoomPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [sharp, setSharp] = useState<Signal[]>([]);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [ev, setEv] = useState<EV[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(0);

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/dashboard`)
      .then(r => r.json())
      .then(d => {
        setGames(d.todayGames ?? []);
        setSharp(d.sharpFeed ?? []);
        setInjuries(d.injuries ?? []);
        setEv(d.positiveEv ?? []);
        setLastUpdate(Date.now());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); const id = window.setInterval(load, 90_000); return () => window.clearInterval(id); }, []);

  const liveGames = games.filter(g => g.status?.toLowerCase() === "live" || g.status?.toLowerCase() === "in_progress");
  const todayGames = games.filter(g => g.status?.toLowerCase() !== "final");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle eyebrow="War Room" title="Command Center" description="Full-spectrum intelligence — all signals in one view." />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LiveDot /> {lastUpdate ? `${timeAgo(new Date(lastUpdate).toISOString())} ago` : "—"}
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border/30 rounded-lg px-3 py-1.5 hover:bg-muted/20 transition disabled:opacity-40">
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Sync
          </button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Today's Games", value: todayGames.length, icon: <CalendarDays className="size-4" />, tone: "neon" },
          { label: "Live Now", value: liveGames.length, icon: <Activity className="size-4" />, tone: "crimson" },
          { label: "Sharp Signals", value: sharp.length, icon: <Flame className="size-4" />, tone: "helix" },
          { label: "+EV Spots", value: ev.length, icon: <TrendingUp className="size-4" />, tone: "emerald" },
        ].map(kpi => (
          <Panel key={kpi.label} className="!p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{kpi.label}</span>
              <span className={kpi.tone === "neon" ? "text-neon" : kpi.tone === "crimson" ? "text-crimson" : kpi.tone === "helix" ? "text-helix" : "text-emerald"}>{kpi.icon}</span>
            </div>
            {loading ? <div className="h-7 w-12 mt-1 rounded shimmer bg-muted/30" /> : <div className="text-2xl font-mono-display font-bold mt-1">{kpi.value}</div>}
          </Panel>
        ))}
      </div>

      {/* Main 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Today's Games */}
        <Panel className="md:col-span-1">
          <PanelHeader title="Today's Slate" subtitle={`${todayGames.length} games`} icon={<CalendarDays className="size-4" />} />
          {loading ? <div className="space-y-1.5 mt-2">{[...Array(6)].map((_,i) => <div key={i} className="h-9 rounded shimmer bg-muted/30" />)}</div> : (
            <div className="space-y-1 mt-1 max-h-72 overflow-y-auto pr-1">
              {todayGames.slice(0, 15).map((g, i) => (
                <div key={g.id ?? i} className="flex items-center justify-between glass rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Pill tone={(SPORT_COLORS[g.sport ?? ""] ?? "neon") as "neon"|"helix"|"emerald"|"crimson"} className="!py-0 !text-[9px]">{g.sport}</Pill>
                    <span>{g.away_team_abbr ?? "?"} @ {g.home_team_abbr ?? "?"}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {g.scheduled_at ? new Date(g.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Sharp Feed */}
        <Panel className="md:col-span-1">
          <PanelHeader title="Sharp Feed" subtitle={`${sharp.length} signals`} icon={<Flame className="size-4" />} right={<Pill tone="crimson">SHARP</Pill>} />
          {loading ? <div className="space-y-1.5 mt-2">{[...Array(5)].map((_,i) => <div key={i} className="h-12 rounded shimmer bg-muted/30" />)}</div> : sharp.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">No signals yet</div>
          ) : (
            <div className="space-y-1.5 mt-1 max-h-72 overflow-y-auto pr-1">
              {sharp.slice(0, 12).map((s, i) => (
                <div key={s.id ?? i} className="glass rounded-lg px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-crimson animate-pulse shrink-0" />
                    <span className="text-[10px] font-semibold text-crimson uppercase tracking-wider">{s.signal_type?.replace(/_/g," ")}</span>
                    {s.sport && <span className="text-[10px] text-muted-foreground ml-auto">{s.sport} · {timeAgo(s.created_at)}</span>}
                  </div>
                  <div className="text-[11px] mt-0.5 truncate">{s.away_team && s.home_team ? `${s.away_team} @ ${s.home_team}` : s.description}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Injuries + EV */}
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Injury Watch" subtitle={`${injuries.length} active`} icon={<HeartPulse className="size-4" />} />
            {loading ? <div className="space-y-1.5 mt-2">{[...Array(4)].map((_,i) => <div key={i} className="h-9 rounded shimmer bg-muted/30" />)}</div> : injuries.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">Clean slate</div>
            ) : (
              <div className="space-y-1 mt-1 max-h-36 overflow-y-auto pr-1">
                {injuries.slice(0, 8).map((inj, i) => {
                  const s = (inj.status ?? "").toLowerCase();
                  const tone = s.includes("out") ? "crimson" : s.includes("quest") || s.includes("doubt") ? "amber" : "neon";
                  return (
                    <div key={inj.id ?? i} className="flex items-center gap-2 text-xs">
                      <Pill tone={tone as "neon"|"crimson"|"amber"} className="!py-0 !text-[9px] shrink-0">{inj.status?.slice(0,5) ?? "?"}</Pill>
                      <span className="truncate">{inj.player?.full_name ?? "Unknown"}</span>
                      <span className="text-muted-foreground shrink-0">{inj.player?.team?.abbreviation}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="+EV Spots" subtitle={`${ev.length} found`} icon={<TrendingUp className="size-4" />} right={<Pill tone="emerald">EV</Pill>} />
            {loading ? <div className="space-y-1.5 mt-2">{[...Array(3)].map((_,i) => <div key={i} className="h-9 rounded shimmer bg-muted/30" />)}</div> : ev.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">No +EV yet</div>
            ) : (
              <div className="space-y-1 mt-1 max-h-36 overflow-y-auto pr-1">
                {ev.slice(0, 6).map((e, i) => (
                  <div key={e.id ?? i} className="flex items-center gap-2 text-xs">
                    <span className="text-emerald font-mono-display font-bold shrink-0">+{((e.edge ?? 0) * 100).toFixed(1)}%</span>
                    <span className="truncate">{e.player_name ?? "—"} {e.stat_type} {e.line}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}