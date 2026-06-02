import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Panel, PanelHeader, Pill, LiveDot, SectionTitle } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import {
  Sparkles, Flame, CalendarDays, TrendingUp, HeartPulse, ArrowRight, Activity, Zap,
} from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Intelligence Dashboard · Oracle Helix" }] }),
  component: Dashboard,
});

type ResearchCard = {
  id?: string;
  title?: string;
  headline?: string;
  summary?: string;
  card_type?: string;
  sport?: string;
  generated_at?: string;
};
type GameRow = {
  id?: string;
  sport?: string;
  home_team?: string; away_team?: string;
  home_team_abbr?: string; away_team_abbr?: string;
  start_time?: string; status?: string;
};
type SharpItem = {
  id?: string; team?: string; team_abbr?: string; signal_type?: string;
  magnitude?: number; created_at?: string; sport?: string;
};
type EvItem = {
  id?: string; game?: string; matchup?: string; market?: string;
  ev?: number; ev_pct?: number; sportsbook?: string; book?: string; edge?: number;
};
type InjuryItem = {
  id?: string; player_name?: string; position?: string; team?: string;
  status?: string;
};
type DashboardPayload = {
  researchCards?: ResearchCard[];
  todayGames?: GameRow[];
  sharpFeed?: SharpItem[];
  positiveEv?: EvItem[];
  injuries?: InjuryItem[];
};

function Dashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [, force] = useState(0);
  const tickRef = useRef<number | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/dashboard`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardPayload;
      setData(json ?? {});
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 60_000);
    const tick = window.setInterval(() => force((x) => x + 1), 1000);
    tickRef.current = tick;
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, []);

  const cards = data?.researchCards ?? [];
  const games = data?.todayGames ?? [];
  const sharp = data?.sharpFeed ?? [];
  const ev = data?.positiveEv ?? [];
  const injuries = data?.injuries ?? [];
  const briefing = cards[0];
  const secondsAgo = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Intelligence Dashboard"
        title="Oracle Helix — Today's signal."
        description="A curated, AI-ranked view of the most actionable intelligence across every market you follow."
        right={
          <Pill tone={error ? "crimson" : "emerald"}>
            <LiveDot /> {error ? `Offline · ${error}` : `Live · Updated ${secondsAgo}s ago`}
          </Pill>
        }
      />

      {/* AI Daily Briefing */}
      <BriefingPanel loading={loading} card={briefing} />

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile loading={loading} label="Today's Games" value={games.length} icon={<CalendarDays className="size-4" />} accent="neon" />
        <StatTile loading={loading} label="Positive EV" value={ev.length} icon={<TrendingUp className="size-4" />} accent="emerald" trend="opportunities" />
        <StatTile loading={loading} label="Sharp Signals" value={sharp.length} icon={<Flame className="size-4" />} accent="helix" trend="last 60 min" />
        <StatTile loading={loading} label="Active Injuries" value={injuries.length} icon={<HeartPulse className="size-4" />} accent="crimson" />
      </div>

      {/* Games + Sharp */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader
            title="Today's Games"
            subtitle="Scheduled matchups across all sports"
            icon={<CalendarDays className="size-4" />}
            right={<Pill tone="muted">{games.length}</Pill>}
          />
          {loading ? <SkeletonList rows={5} /> : games.length === 0 ? (
            <EmptyState text="No games scheduled today" />
          ) : (
            <ul className="divide-y divide-border/60">
              {games.slice(0, 8).map((g, i) => (
                <li key={g.id ?? i} className="py-3 flex items-center gap-3 group">
                  <Pill tone="neon">{g.sport ?? "—"}</Pill>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      <span className="text-muted-foreground">{g.away_team_abbr ?? g.away_team ?? "AWAY"}</span>{" "}
                      <span className="text-muted-foreground/60 mx-1">@</span>
                      <span>{g.home_team_abbr ?? g.home_team ?? "HOME"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5" suppressHydrationWarning>
                      {g.start_time ? new Date(g.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}
                    </div>
                  </div>
                  <StatusPill status={g.status} />
                  <ArrowRight className="size-3.5 text-muted-foreground/40 group-hover:text-primary transition" />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Sharp Money Feed"
            subtitle="Real-time signals"
            icon={<Flame className="size-4" />}
            right={<Pill tone="crimson"><LiveDot /> Sharp</Pill>}
          />
          {loading ? <SkeletonList rows={5} /> : sharp.length === 0 ? (
            <EmptyState text="No sharp signals right now" />
          ) : (
            <ul className="space-y-3">
              {sharp.slice(0, 6).map((s, i) => {
                const mag = Math.min(100, Math.max(0, (s.magnitude ?? 0) * (s.magnitude && s.magnitude <= 1 ? 100 : 1)));
                const hot = mag >= 70;
                return (
                  <li key={s.id ?? i} className="flex items-center gap-3">
                    <span className={hot ? "pulse-dot crimson" : "size-2 rounded-full bg-helix"} />
                    <div className="w-12 font-mono-display text-xs text-foreground">{s.team_abbr ?? s.team ?? "—"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">{s.signal_type ?? "signal"}</div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full bg-gradient-helix" style={{ width: `${mag}%` }} />
                      </div>
                    </div>
                    <div className="text-[10px] font-mono-display text-muted-foreground w-14 text-right">{timeAgo(s.created_at)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* EV + Injuries */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader
            title="Best EV Opportunities"
            subtitle="Positive expected value across markets"
            icon={<TrendingUp className="size-4" />}
            right={<Pill tone="emerald">+EV</Pill>}
          />
          {loading ? <SkeletonList rows={5} /> : ev.length === 0 ? (
            <EmptyState text="No +EV opportunities right now" />
          ) : (
            <ul className="divide-y divide-border/60">
              {ev.slice(0, 6).map((e, i) => {
                const pct = e.ev_pct ?? e.ev ?? e.edge ?? 0;
                const edge = Math.min(100, Math.max(0, Math.abs(pct) * (Math.abs(pct) <= 1 ? 100 : 1)));
                return (
                  <li key={e.id ?? i} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{e.matchup ?? e.game ?? "Matchup"}</div>
                      <div className="text-xs text-muted-foreground">{e.market ?? "market"} · {e.sportsbook ?? e.book ?? "—"}</div>
                      <div className="mt-1.5 h-1 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full bg-emerald" style={{ width: `${edge}%` }} />
                      </div>
                    </div>
                    <div className="font-mono-display text-sm text-emerald shrink-0">
                      +{(Math.abs(pct) <= 1 ? Math.abs(pct) * 100 : Math.abs(pct)).toFixed(1)}%
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Injury Intelligence"
            subtitle="Status across active rosters"
            icon={<HeartPulse className="size-4" />}
            right={<Pill tone="amber">{injuries.length}</Pill>}
          />
          {loading ? <SkeletonList rows={5} /> : injuries.length === 0 ? (
            <EmptyState text="No active injury alerts" />
          ) : (
            <ul className="divide-y divide-border/60">
              {injuries.slice(0, 7).map((p, i) => (
                <li key={p.id ?? i} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.player_name ?? "Player"}</div>
                    <div className="text-xs text-muted-foreground">{p.position ?? "—"} · {p.team ?? "—"}</div>
                  </div>
                  <InjuryStatus status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Research cards row */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-helix" />
            <h3 className="font-semibold text-sm uppercase tracking-[0.18em]">AI Research Cards</h3>
          </div>
          <Link to="/ai" className="text-xs text-primary hover:underline">Open AI Command →</Link>
        </div>
        {loading ? (
          <div className="grid md:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : cards.length === 0 ? (
          <EmptyState text="No research cards yet — Oracle Helix agents will publish here when signals develop." />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {cards.map((c, i) => (
              <div key={c.id ?? i} className="snap-start shrink-0 w-[300px] glass rounded-xl p-4 border border-helix/20 hover:border-helix/50 transition group">
                <div className="flex items-center gap-2">
                  <Pill tone="helix">{c.card_type ?? "insight"}</Pill>
                  {c.sport && <Pill tone="muted">{c.sport}</Pill>}
                </div>
                <div className="mt-3 font-semibold text-sm leading-snug">{c.title ?? c.headline ?? "Untitled insight"}</div>
                {c.headline && c.title && c.headline !== c.title && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">{c.headline}</p>
                )}
                {c.summary && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">{c.summary}</p>}
                <div className="mt-3 flex items-center justify-between text-[10px] font-mono-display text-muted-foreground">
                  <span>{timeAgo(c.generated_at)}</span>
                  <ArrowRight className="size-3 group-hover:translate-x-0.5 group-hover:text-helix transition" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Minimal markdown → JSX: handles ##/###, **bold**, *italic*, - bullets, blank-line paragraphs */
function MarkdownProse({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      nodes.push(
        <ul key={nodes.length} className="mt-2 space-y-1 list-disc list-inside text-sm text-muted-foreground">
          {listItems.map((li, i) => <li key={i}>{renderInline(li)}</li>)}
        </ul>
      );
      listItems = [];
    }
  };

  const renderInline = (s: string): React.ReactNode => {
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-foreground font-semibold">{p.slice(2, -2)}</strong>;
      if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
      return p;
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    if (line.startsWith("### ")) { flushList(); nodes.push(<h4 key={nodes.length} className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary/80">{line.slice(4)}</h4>); continue; }
    if (line.startsWith("## ")) { flushList(); nodes.push(<h3 key={nodes.length} className="mt-4 text-sm font-bold text-foreground border-t border-border/40 pt-3">{line.slice(3)}</h3>); continue; }
    if (line.startsWith("- ") || line.startsWith("* ")) { listItems.push(line.slice(2)); continue; }
    flushList();
    nodes.push(<p key={nodes.length} className="mt-2 text-sm text-muted-foreground leading-relaxed">{renderInline(line)}</p>);
  }
  flushList();
  return <div className="mt-3 max-w-3xl">{nodes}</div>;
}

function BriefingPanel({ loading, card }: { loading: boolean; card?: ResearchCard }) {
  const text = card?.headline ?? card?.title ?? "";
  const [typed, setTyped] = useState("");
  const [nowLabel, setNowLabel] = useState<string>("—:—");
  useEffect(() => {
    const update = () => setNowLabel(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    setTyped("");
    if (!text) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setTyped(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [text]);

  return (
    <Panel className="!p-6 relative overflow-hidden" glow="helix">
      <div className="absolute -top-24 -right-24 size-72 bg-gradient-helix opacity-25 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 rounded-[inherit] ring-1 ring-primary/30 animate-pulse pointer-events-none" />
      <div className="flex items-start gap-4 relative">
        <div className="size-11 rounded-lg bg-gradient-helix grid place-items-center shrink-0">
          <Sparkles className="size-5 text-background" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.25em] text-primary flex items-center gap-2">
            <LiveDot /> Oracle Helix · Daily Brief · <span suppressHydrationWarning>{nowLabel}</span>
          </div>
          {loading ? (
            <>
              <div className="h-6 w-2/3 mt-3 rounded shimmer bg-muted/30" />
              <div className="h-4 w-full mt-3 rounded shimmer bg-muted/30" />
              <div className="h-4 w-5/6 mt-2 rounded shimmer bg-muted/30" />
            </>
          ) : !card ? (
            <>
              <h2 className="text-xl md:text-2xl font-semibold mt-1.5">No briefing available yet.</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
                The Oracle Helix agents are scanning markets — your daily brief will appear here as soon as the next signal is published.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl md:text-2xl font-semibold mt-1.5">
                {typed}
                <span className="inline-block w-1.5 h-5 bg-primary/80 ml-1 align-middle animate-pulse" />
              </h2>
              {card.summary && <MarkdownProse text={card.summary} />}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function StatTile({
  loading, label, value, icon, accent, trend,
}: {
  loading: boolean; label: string; value: number | string;
  icon: React.ReactNode;
  accent: "neon" | "helix" | "emerald" | "crimson";
  trend?: string;
}) {
  const accentCls = {
    neon: "text-primary", helix: "text-helix", emerald: "text-emerald", crimson: "text-crimson",
  }[accent];
  return (
    <Panel className="!p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={accentCls}>{icon}</div>
      </div>
      {loading ? (
        <div className="h-8 w-20 mt-2 rounded shimmer bg-muted/30" />
      ) : (
        <div className="mt-1 font-mono-display text-3xl font-semibold">{value}</div>
      )}
      {trend && <div className="text-[11px] text-muted-foreground mt-0.5">{trend}</div>}
    </Panel>
  );
}

function StatusPill({ status }: { status?: string }) {
  const s = (status ?? "scheduled").toLowerCase();
  if (s.includes("live") || s.includes("progress")) return <Pill tone="emerald"><LiveDot /> LIVE</Pill>;
  if (s.includes("final")) return <Pill tone="muted">Final</Pill>;
  if (s.includes("delay") || s.includes("post")) return <Pill tone="amber">{status}</Pill>;
  return <Pill tone="neon">Scheduled</Pill>;
}

function InjuryStatus({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  if (s.includes("out") || s.includes("ir")) return <Pill tone="crimson">{status ?? "OUT"}</Pill>;
  if (s.includes("quest") || s.includes("game-time") || s.includes("doubt")) return <Pill tone="amber">{status}</Pill>;
  if (s.includes("prob") || s.includes("active")) return <Pill tone="emerald">{status}</Pill>;
  return <Pill tone="muted">{status ?? "—"}</Pill>;
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-8 rounded shimmer bg-muted/30" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded shimmer bg-muted/30" />
            <div className="h-2.5 w-1/2 rounded shimmer bg-muted/20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <div className="h-4 w-16 rounded shimmer bg-muted/30" />
      <div className="h-4 w-full rounded shimmer bg-muted/30" />
      <div className="h-3 w-3/4 rounded shimmer bg-muted/20" />
      <div className="h-3 w-1/2 rounded shimmer bg-muted/20" />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
      <Activity className="size-5 opacity-40" />
      {text}
    </div>
  );
}

function timeAgo(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Keep an unused import referenced for tree-shake safety
void Zap;
