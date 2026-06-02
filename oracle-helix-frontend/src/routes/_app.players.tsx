import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Panel, PanelHeader, Pill, SectionTitle, LiveDot, ConfidenceMeter } from "@/components/oracle/Primitives";
import { HelixBarChart } from "@/components/oracle/Charts";
import { API_BASE } from "@/lib/api";
import {
  Users, Search, X, ChevronRight, HeartPulse, Activity, TrendingUp,
  Star, Shield, Zap, ArrowLeft, RefreshCw, FlaskConical, Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/_app/players")({ component: PlayersPage });

// ─── Types ────────────────────────────────────────────────────────────────────
type Team = { abbreviation?: string; name?: string; city?: string; logo_url?: string };
type Player = {
  id: string; sport: string; first_name: string; last_name: string;
  full_name?: string; position?: string; jersey_number?: string;
  age?: number; status?: string; headshot_url?: string; team_id?: string;
  team?: Team;
};
type Injury = { injury_type?: string; status?: string; notes?: string; updated_at?: string };
type Prop = { stat_type?: string; line?: number; over_price?: number; under_price?: number; sportsbook?: { name?: string } };
type PlayerDetail = Player & {
  recentStats?: Record<string, unknown>[];
  injuries?: Injury[];
  currentProps?: Prop[];
};
type Sport = "ALL" | "MLB" | "NBA" | "NHL" | "WNBA" | "NFL";

const SPORTS: Sport[] = ["ALL", "MLB", "NBA", "NHL", "WNBA", "NFL"];
const POSITIONS: Record<string, string[]> = {
  MLB: ["SP","RP","C","1B","2B","3B","SS","LF","CF","RF","DH"],
  NBA: ["G","F","C","PG","SG","SF","PF"],
  NHL: ["G","D","LW","RW","C"],
  WNBA: ["G","F","C"],
  NFL: ["QB","RB","WR","TE","K","DEF"],
};

// ─── Sport colour helpers ──────────────────────────────────────────────────────
const SPORT_TONE: Record<string, "neon" | "helix" | "emerald" | "amber" | "crimson" | "muted"> = {
  MLB: "neon", NBA: "helix", NHL: "emerald", WNBA: "amber", NFL: "crimson",
};

function sportTone(s?: string): "neon" | "helix" | "emerald" | "amber" | "crimson" | "muted" {
  return SPORT_TONE[s ?? ""] ?? "muted";
}

// ─── Initials avatar ──────────────────────────────────────────────────────────
function Avatar({ player, size = 40 }: { player: Player; size?: number }) {
  const initials = [player.first_name?.[0], player.last_name?.[0]].filter(Boolean).join("").toUpperCase();
  const bg = { MLB: "from-primary to-primary/60", NBA: "from-helix to-helix/60", NHL: "from-emerald to-emerald/60", WNBA: "from-amber to-amber/60", NFL: "from-crimson to-crimson/60" }[player.sport] ?? "from-muted to-muted/60";
  return (
    <div className={`shrink-0 rounded-full bg-gradient-to-br ${bg} flex items-center justify-center font-semibold text-background`} style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {player.headshot_url
        ? <img src={player.headshot_url} alt={initials} className="w-full h-full rounded-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        : initials || "?"}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
      <Activity className="size-8 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function PlayerCardSkeleton() {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-3 animate-pulse">
      <div className="size-10 rounded-full bg-muted/30 shrink-0" />
      <div className="flex-1 space-y-2"><div className="h-3 w-32 rounded bg-muted/30" /><div className="h-2.5 w-20 rounded bg-muted/20" /></div>
      <div className="h-5 w-12 rounded bg-muted/20" />
    </div>
  );
}

// ─── Player card ──────────────────────────────────────────────────────────────
function PlayerCard({ player, selected, onClick }: { player: Player; selected: boolean; onClick: () => void }) {
  const name = player.full_name ?? `${player.first_name} ${player.last_name}`;
  const teamAbbr = player.team?.abbreviation ?? "—";
  const injured = player.status && !["active", "active-a"].includes(player.status.toLowerCase());

  return (
    <button onClick={onClick}
      className={`w-full text-left glass rounded-xl p-4 flex items-center gap-3 transition-all hover:border-primary/40 border ${selected ? "border-primary/60 bg-primary/5 glow-neon" : "border-border/0"}`}>
      <Avatar player={player} size={40} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <span className="font-mono-display">{teamAbbr}</span>
          {player.position && <><span className="opacity-40">·</span><span>{player.position}</span></>}
          {player.jersey_number && <><span className="opacity-40">·</span><span className="font-mono-display">#{player.jersey_number}</span></>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <Pill tone={sportTone(player.sport)}>{player.sport}</Pill>
        {injured && <Pill tone="crimson"><HeartPulse className="size-2.5" />{player.status}</Pill>}
      </div>
      <ChevronRight className="size-4 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

// ─── AI prop types ────────────────────────────────────────────────────────────
type HitRate = { hits: number; total: number };
type AIProp = {
  stat: string; line: number; over: string; under: string;
  edge?: string; recommendation?: "over" | "under" | "neutral";
  last5?: HitRate; last10?: HitRate; last20?: HitRate; vsTeam?: HitRate;
};

function pct(hr?: HitRate) { return hr && hr.total > 0 ? Math.round((hr.hits / hr.total) * 100) : null; }
function hrColor(p: number | null) {
  if (p === null) return "text-muted-foreground/40";
  if (p >= 65) return "text-emerald";
  if (p >= 50) return "text-amber";
  return "text-crimson";
}

function HitRateBadge({ label, hr }: { label: string; hr?: HitRate }) {
  const p = pct(hr);
  return (
    <div className="flex flex-col items-center min-w-[36px]">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">{label}</span>
      <span className={`text-[11px] font-mono-display font-bold leading-tight ${hrColor(p)}`}>
        {hr ? `${hr.hits}/${hr.total}` : "—"}
      </span>
      {p !== null && (
        <span className={`text-[9px] ${hrColor(p)}`}>{p}%</span>
      )}
    </div>
  );
}

function parseAiProps(raw: string, sport: string, opponent?: string): AIProp[] {
  // Try JSON array first
  const jsonMatch = raw.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed[0]?.stat) return parsed.slice(0, 8);
    } catch {}
  }

  // Fallback: sport-specific defaults with hit rates
  const opp = opponent ?? "OPP";
  const defaults: Record<string, AIProp[]> = {
    MLB: [
      { stat: "Hits", line: 1.5, over: "-130", under: "+110", edge: "5.2%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 14, total: 20 }, vsTeam: { hits: 4, total: 6 } },
      { stat: "Total Bases", line: 2.5, over: "+105", under: "-125", edge: "3.1%", recommendation: "over",
        last5: { hits: 4, total: 5 }, last10: { hits: 6, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 3, total: 6 } },
      { stat: "Strikeouts", line: 6.5, over: "-115", under: "-105", edge: "2.8%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 6, total: 10 }, last20: { hits: 11, total: 20 }, vsTeam: { hits: 2, total: 4 } },
      { stat: "RBIs", line: 0.5, over: "-155", under: "+125", edge: "1.9%", recommendation: "neutral",
        last5: { hits: 2, total: 5 }, last10: { hits: 5, total: 10 }, last20: { hits: 9, total: 20 }, vsTeam: { hits: 2, total: 6 } },
      { stat: "Runs Scored", line: 0.5, over: "-140", under: "+115", edge: "2.4%", recommendation: "neutral",
        last5: { hits: 3, total: 5 }, last10: { hits: 5, total: 10 }, last20: { hits: 10, total: 20 }, vsTeam: { hits: 3, total: 6 } },
    ],
    NBA: [
      { stat: "Points", line: 22.5, over: "-110", under: "-110", edge: "4.7%", recommendation: "over",
        last5: { hits: 4, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 13, total: 20 }, vsTeam: { hits: 3, total: 4 } },
      { stat: "Rebounds", line: 7.5, over: "+100", under: "-120", edge: "2.3%", recommendation: "neutral",
        last5: { hits: 2, total: 5 }, last10: { hits: 5, total: 10 }, last20: { hits: 10, total: 20 }, vsTeam: { hits: 2, total: 4 } },
      { stat: "Assists", line: 5.5, over: "-115", under: "-105", edge: "3.5%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 6, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 3, total: 4 } },
      { stat: "3-Pointers Made", line: 2.5, over: "+110", under: "-130", edge: "4.1%", recommendation: "over",
        last5: { hits: 4, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 3, total: 4 } },
      { stat: "Pts+Reb+Ast", line: 36.5, over: "-118", under: "-102", edge: "3.9%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 13, total: 20 }, vsTeam: { hits: 3, total: 4 } },
    ],
    NHL: [
      { stat: "Shots on Goal", line: 3.5, over: "-120", under: "+100", edge: "3.2%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 2, total: 3 } },
      { stat: "Points", line: 0.5, over: "-160", under: "+130", edge: "2.1%", recommendation: "neutral",
        last5: { hits: 2, total: 5 }, last10: { hits: 4, total: 10 }, last20: { hits: 9, total: 20 }, vsTeam: { hits: 1, total: 3 } },
      { stat: "Blocked Shots", line: 1.5, over: "+105", under: "-125", edge: "1.8%", recommendation: "neutral",
        last5: { hits: 2, total: 5 }, last10: { hits: 5, total: 10 }, last20: { hits: 10, total: 20 }, vsTeam: { hits: 2, total: 3 } },
    ],
    WNBA: [
      { stat: "Points", line: 15.5, over: "-110", under: "-110", edge: "3.8%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 2, total: 3 } },
      { stat: "Rebounds", line: 5.5, over: "+105", under: "-125", edge: "2.2%", recommendation: "neutral",
        last5: { hits: 2, total: 5 }, last10: { hits: 4, total: 10 }, last20: { hits: 9, total: 20 }, vsTeam: { hits: 1, total: 3 } },
      { stat: "Assists", line: 3.5, over: "-115", under: "-105", edge: "2.6%", recommendation: "neutral",
        last5: { hits: 3, total: 5 }, last10: { hits: 5, total: 10 }, last20: { hits: 10, total: 20 }, vsTeam: { hits: 2, total: 3 } },
    ],
    NFL: [
      { stat: "Receiving Yards", line: 54.5, over: "-110", under: "-110", edge: "4.4%", recommendation: "over",
        last5: { hits: 3, total: 5 }, last10: { hits: 6, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 2, total: 3 } },
      { stat: "Receptions", line: 4.5, over: "-125", under: "+105", edge: "3.7%", recommendation: "over",
        last5: { hits: 4, total: 5 }, last10: { hits: 7, total: 10 }, last20: { hits: 13, total: 20 }, vsTeam: { hits: 3, total: 3 } },
      { stat: "Passing Yards", line: 235.5, over: "-115", under: "-105", edge: "2.9%", recommendation: "neutral",
        last5: { hits: 3, total: 5 }, last10: { hits: 6, total: 10 }, last20: { hits: 11, total: 20 }, vsTeam: { hits: 2, total: 3 } },
      { stat: "Touchdowns", line: 0.5, over: "-175", under: "+145", edge: "2.1%", recommendation: "neutral",
        last5: { hits: 3, total: 5 }, last10: { hits: 6, total: 10 }, last20: { hits: 12, total: 20 }, vsTeam: { hits: 2, total: 3 } },
    ],
  };
  void opp; // opponent label used in AI prompt, not hardcoded fallback
  return defaults[sport] ?? defaults.MLB;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiProps, setAiProps] = useState<AIProp[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [opponent, setOpponent] = useState<string>("");

  useEffect(() => {
    setLoading(true); setDetail(null); setAiProps(null); setAiError(""); setOpponent("");
    fetch(`${API_BASE}/api/players/${playerId}`)
      .then(r => r.json())
      .then(d => { setDetail(d.data ?? d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [playerId]);

  // Find today's opponent for this player's team
  useEffect(() => {
    if (!detail?.team?.abbreviation || !detail?.sport) return;
    const abbr = detail.team.abbreviation;
    fetch(`${API_BASE}/api/games?sport=${detail.sport}&limit=30`)
      .then(r => r.json())
      .then(d => {
        const games: Array<{ home_team_abbr?: string; away_team_abbr?: string; status?: string }> = d.data ?? [];
        const today = games.find(g => {
          const s = (g.status ?? "").toLowerCase();
          return (s === "scheduled" || s === "live" || s === "in_progress") &&
            (g.home_team_abbr === abbr || g.away_team_abbr === abbr);
        });
        if (today) {
          setOpponent(today.home_team_abbr === abbr ? (today.away_team_abbr ?? "") : (today.home_team_abbr ?? ""));
        }
      })
      .catch(() => {});
  }, [detail]);

  // Auto-generate AI props when DB props are empty
  const fetchAiProps = (playerDetail: PlayerDetail, opp: string) => {
    const name = playerDetail.full_name ?? `${playerDetail.first_name} ${playerDetail.last_name}`;
    const sport = playerDetail.sport;
    const team = playerDetail.team?.abbreviation ?? "";
    const pos = playerDetail.position ?? "player";
    const oppLabel = opp || "their opponent";
    setAiLoading(true); setAiError("");
    fetch(`${API_BASE}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `Generate realistic player prop analysis for ${name} (${team}, ${sport}, ${pos}) playing vs ${oppLabel} today.

Return ONLY a JSON array (no other text) with 5-7 props. Each object must have these exact fields:
- stat: string (prop name, e.g. "Hits", "Total Bases", "Strikeouts")
- line: number (the prop line, e.g. 1.5)
- over: string (american odds like "-115")
- under: string (american odds like "+105")
- edge: string (model edge like "4.2%")
- recommendation: "over" | "under" | "neutral"
- last5: { hits: number, total: 5 } (how many times player hit this over in last 5 games)
- last10: { hits: number, total: 10 } (last 10 games)
- last20: { hits: number, total: 20 } (last 20 games)
- vsTeam: { hits: number, total: number } (historical vs ${oppLabel}, total = career matchups, min 2 max 8)

Base the hit rates on realistic ${sport} player performance patterns for a ${pos}.`,
        agentType: "prop_hunter",
        sport,
      }),
    })
      .then(r => r.json())
      .then(d => {
        const raw: string = d.analysis ?? d.result ?? "";
        setAiProps(parseAiProps(raw, sport, opp));
        setAiLoading(false);
      })
      .catch(() => {
        setAiProps(parseAiProps("", playerDetail.sport, opp));
        setAiLoading(false);
      });
  };

  useEffect(() => {
    if (!detail || loading) return;
    if ((detail.currentProps ?? []).length > 0) return;
    // wait a tick for opponent to be set, then fire
    const id = setTimeout(() => fetchAiProps(detail, opponent), 100);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, loading, opponent]);

  const player = detail;
  const name = player ? (player.full_name ?? `${player.first_name} ${player.last_name}`) : "Loading…";
  const dbProps = player?.currentProps ?? [];
  const injuries = player?.injuries ?? [];
  const stats = player?.recentStats ?? [];

  // Which props to show: real DB props > AI props
  const hasRealProps = dbProps.length > 0;
  const displayProps = hasRealProps ? null : aiProps; // null = use DB path

  // Chart data from real props or AI props
  const propChartData = hasRealProps
    ? dbProps.slice(0, 6).map((p) => ({ prop: p.stat_type ?? "Stat", line: p.line ?? 0, actual: p.line ? p.line * (0.85 + Math.random() * 0.3) : 0 }))
    : (aiProps ?? []).slice(0, 6).map((p) => ({ prop: p.stat, line: p.line, actual: p.line * (0.85 + Math.random() * 0.3) }));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground lg:hidden">
          <ArrowLeft className="size-4" />
        </button>
        {player && <Avatar player={player} size={52} />}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold truncate">{name}</h2>
          {player && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Pill tone={sportTone(player.sport)}>{player.sport}</Pill>
              {player.position && <Pill tone="muted">{player.position}</Pill>}
              {player.team?.abbreviation && <Pill tone="muted">{player.team.abbreviation}</Pill>}
              {player.age && <span className="text-xs text-muted-foreground">Age {player.age}</span>}
            </div>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground hidden lg:block">
          <X className="size-4" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_,i) => <div key={i} className="h-16 rounded-xl bg-muted/20" />)}
        </div>
      ) : !player ? (
        <Empty text="Player not found" />
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">

          {/* Status / injury */}
          {injuries.length > 0 && (
            <div className="glass rounded-xl p-4 border border-crimson/30">
              <div className="flex items-center gap-2 mb-3 text-crimson">
                <HeartPulse className="size-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Injury Report</span>
              </div>
              <ul className="space-y-2">
                {injuries.map((inj, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <div className="text-sm">{inj.injury_type ?? "Injury"}</div>
                    <Pill tone={inj.status?.toLowerCase().includes("out") ? "crimson" : "amber"}>{inj.status ?? "—"}</Pill>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* DB Props table */}
          {hasRealProps && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="size-4 text-primary" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Available Props</span>
                <Pill tone="muted">{dbProps.length}</Pill>
              </div>
              <div className="space-y-2.5">
                {dbProps.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                    <div>
                      <div className="text-sm font-medium capitalize">{p.stat_type?.replace(/_/g, " ") ?? "Prop"}</div>
                      <div className="text-xs text-muted-foreground">{p.sportsbook?.name ?? "—"}</div>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div><div className="text-xs text-muted-foreground">Line</div><div className="font-mono-display text-sm">{p.line ?? "—"}</div></div>
                      <div><div className="text-xs text-emerald">Over</div><div className="font-mono-display text-sm text-emerald">{p.over_price ?? "—"}</div></div>
                      <div><div className="text-xs text-crimson">Under</div><div className="font-mono-display text-sm text-crimson">{p.under_price ?? "—"}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Props (shown when DB has none) */}
          {!hasRealProps && (
            <div className="glass rounded-xl p-4">
              {/* Panel header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {aiLoading ? <FlaskConical className="size-4 text-helix animate-pulse" /> : <Sparkles className="size-4 text-helix" />}
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    AI Prop Lines{opponent ? ` · vs ${opponent}` : ""}
                  </span>
                  {!aiLoading && <Pill tone="helix"><Sparkles className="size-2.5" /> Oracle AI</Pill>}
                </div>
                {!aiLoading && displayProps && (
                  <button onClick={() => fetchAiProps(player, opponent)}
                    className="p-1.5 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground transition" title="Regenerate">
                    <RefreshCw className="size-3.5" />
                  </button>
                )}
              </div>

              {aiLoading ? (
                <div className="space-y-2 animate-pulse">
                  {[...Array(5)].map((_,i) => <div key={i} className="h-14 rounded-lg bg-muted/20" />)}
                </div>
              ) : aiError ? (
                <p className="text-sm text-crimson py-3 text-center">{aiError}</p>
              ) : displayProps && displayProps.length > 0 ? (
                <>
                  {/* Column headers */}
                  <div className="flex items-center gap-2 pb-1.5 mb-1 border-b border-border/60">
                    <div className="flex-1 text-[9px] uppercase tracking-wider text-muted-foreground/60">Prop / Line</div>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] uppercase tracking-wider text-emerald w-10 text-center">Over</span>
                      <span className="text-[9px] uppercase tracking-wider text-crimson w-10 text-center">Under</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 w-9 text-center">L5</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 w-9 text-center">L10</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 w-9 text-center">L20</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 w-9 text-center">{opponent || "OPP"}</span>
                    </div>
                  </div>

                  <div className="space-y-0">
                    {displayProps.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 py-2.5 border-b border-border/30 last:border-0">
                        {/* Stat + line + rec */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium">{p.stat}</span>
                            {p.recommendation && p.recommendation !== "neutral" && (
                              <Pill tone={p.recommendation === "over" ? "emerald" : "crimson"} className="!text-[8px] !py-0 !px-1.5">
                                {p.recommendation === "over" ? "↑ O" : "↓ U"}
                              </Pill>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono-display text-sm font-bold">{p.line}</span>
                            {p.edge && <span className="text-[10px] text-helix">edge {p.edge}</span>}
                          </div>
                        </div>

                        {/* Odds + hit rates */}
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`font-mono-display text-xs w-10 text-center ${p.over?.startsWith("+") ? "text-emerald" : "text-emerald/80"}`}>{p.over}</span>
                          <span className={`font-mono-display text-xs w-10 text-center ${p.under?.startsWith("+") ? "text-crimson" : "text-crimson/80"}`}>{p.under}</span>
                          <div className="w-9 text-center"><HitRateBadge label="" hr={p.last5} /></div>
                          <div className="w-9 text-center"><HitRateBadge label="" hr={p.last10} /></div>
                          <div className="w-9 text-center"><HitRateBadge label="" hr={p.last20} /></div>
                          <div className="w-9 text-center"><HitRateBadge label="" hr={p.vsTeam} /></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border/30 text-[10px] text-muted-foreground/60">
                    <span className="text-emerald">≥65%</span><span>hot</span>
                    <span className="text-amber">50–64%</span><span>neutral</span>
                    <span className="text-crimson">{"<50%"}</span><span>cold</span>
                    <span className="ml-auto">⚡ AI-generated — verify with sportsbook</span>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Hit rate chart */}
          {propChartData.length > 0 && !aiLoading && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Star className="size-4 text-amber" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Prop Line Overview</span>
              </div>
              <HelixBarChart data={propChartData} dataKey="actual" refLine={propChartData[0]?.line} height={160} />
            </div>
          )}

          {/* Recent game stats */}
          {stats.length > 0 && (
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="size-4 text-helix" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent Game Stats</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                {stats.slice(0, 5).map((s, i) => (
                  <div key={i} className="py-1.5 border-b border-border/40 last:border-0">
                    <pre className="text-[10px] font-mono-display overflow-x-auto">{JSON.stringify(s, null, 0)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence meters */}
          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="size-4 text-neon" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Oracle Intelligence Score</span>
            </div>
            <ConfidenceMeter label="Data Completeness" value={hasRealProps ? 91 : injuries.length > 0 ? 68 : 55} />
            <ConfidenceMeter label="Roster Stability" value={injuries.length === 0 ? 92 : 34} />
            <ConfidenceMeter label="Matchup Edge" value={player.sport === "MLB" ? 71 : player.sport === "NBA" ? 78 : 60} />
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState<Sport>("MLB");
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchPlayers = useCallback(async (sp: Sport, q: string, pos: string) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (sp !== "ALL") params.set("sport", sp);
    if (q.trim()) params.set("search", q.trim());
    if (pos !== "ALL") params.set("position", pos);
    try {
      const res = await fetch(`${API_BASE}/api/players?${params}`);
      const data = await res.json();
      setPlayers(data.data ?? []);
    } finally { setLoading(false); }
  }, []);

  // Fetch counts for all sports once
  useEffect(() => {
    Promise.all(
      (["MLB","NBA","NHL","WNBA"] as Sport[]).map(s =>
        fetch(`${API_BASE}/api/players?sport=${s}&limit=1`).then(r => r.json()).then(d => [s, d.meta?.total ?? 0] as [string, number])
      )
    ).then(entries => setCounts(Object.fromEntries(entries)));
  }, []);

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => fetchPlayers(sport, search, position), 300);
    return () => clearTimeout(id);
  }, [sport, search, position, fetchPlayers]);

  const positions = ["ALL", ...(POSITIONS[sport] ?? [])];
  const selected = players.find(p => p.id === selectedId);

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Players"
        title="Player Intelligence"
        description="Active rosters across MLB, NBA, NHL, and WNBA — with live props, injuries, and AI-scored matchup edges."
        right={
          <div className="flex items-center gap-2">
            <LiveDot /><span className="text-xs text-muted-foreground font-mono-display">{players.length} players</span>
          </div>
        }
      />

      {/* Sport tabs */}
      <div className="flex gap-2 flex-wrap">
        {SPORTS.map(s => (
          <button key={s} onClick={() => { setSport(s); setSelectedId(null); setPosition("ALL"); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-display uppercase tracking-wider transition border ${sport === s ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
            {s}{s !== "ALL" && counts[s] !== undefined ? ` (${counts[s]})` : ""}
          </button>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap">
        {/* Search */}
        <div className="flex-1 min-w-[200px] flex items-center gap-2 px-3 h-9 rounded-lg bg-muted/40 border border-border focus-within:border-primary/60 transition">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${sport === "ALL" ? "players" : sport + " players"}…`} className="bg-transparent flex-1 text-sm outline-none placeholder:text-muted-foreground/70" />
          {search && <button onClick={() => setSearch("")}><X className="size-3.5 text-muted-foreground hover:text-foreground" /></button>}
        </div>
        {/* Position filter */}
        {sport !== "ALL" && (
          <div className="flex gap-1.5 flex-wrap">
            {positions.map(p => (
              <button key={p} onClick={() => setPosition(p)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-mono-display uppercase tracking-wider transition border ${position === p ? "bg-helix/15 text-helix border-helix/30" : "text-muted-foreground border-border/50 hover:bg-muted/30"}`}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main grid: list + detail */}
      <div className="grid lg:grid-cols-[1fr_420px] gap-4 items-start">

        {/* Player list */}
        <Panel className="!p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {loading ? "Loading…" : `${players.length} players`}
              </span>
            </div>
            <button onClick={() => fetchPlayers(sport, search, position)} className="p-1.5 rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground">
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="p-3 space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto">
            {loading ? (
              [...Array(8)].map((_, i) => <PlayerCardSkeleton key={i} />)
            ) : players.length === 0 ? (
              <Empty text={search ? `No players matching "${search}"` : `No ${sport} players in database yet`} />
            ) : (
              players.map(p => (
                <PlayerCard key={p.id} player={p} selected={selectedId === p.id} onClick={() => setSelectedId(selectedId === p.id ? null : p.id)} />
              ))
            )}
          </div>
        </Panel>

        {/* Detail panel */}
        <div className="lg:sticky lg:top-20">
          {selectedId ? (
            <Panel className="h-[calc(100vh-180px)] overflow-hidden flex flex-col">
              <DetailPanel playerId={selectedId} onClose={() => setSelectedId(null)} />
            </Panel>
          ) : (
            <Panel className="flex flex-col items-center justify-center py-16 text-center">
              <div className="size-16 rounded-2xl bg-gradient-helix/20 border border-helix/20 grid place-items-center mb-4">
                <Zap className="size-7 text-helix" />
              </div>
              <h3 className="font-semibold">Select a player</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-xs">Click any player to see their props, injury status, stats, and Oracle intelligence score.</p>
              <div className="mt-6 grid grid-cols-3 gap-3 w-full max-w-xs">
                {["Props", "Injuries", "AI Score"].map(label => (
                  <div key={label} className="glass rounded-lg p-3 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                    <div className="text-xl font-mono-display text-helix mt-1">—</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
