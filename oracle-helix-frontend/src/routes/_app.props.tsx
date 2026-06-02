import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle, Stat } from "@/components/oracle/Primitives";
import { HitRateChart } from "@/components/oracle/Charts";
import { API_BASE } from "@/lib/api";
import { Users, Search, Target, BarChart3, ChevronRight, Layers } from "lucide-react";

export const Route = createFileRoute("/_app/props")({ component: PropsPage });

const SPORTS = ["MLB", "NBA", "WNBA", "NHL", "NFL"];

type Game = {
  id?: string; sport?: string;
  home_team_name?: string; away_team_name?: string;
  home_team_abbr?: string; away_team_abbr?: string;
  scheduled_at?: string;
};

type Prop = {
  id?: string; player_id?: string; stat_type?: string;
  line?: number; over_price?: number; under_price?: number;
  over_prob?: number; under_prob?: number; best_book?: string;
  player?: { full_name?: string; position?: string; headshot_url?: string };
  sportsbook?: { key?: string; name?: string };
};

type RecentStat = {
  stats?: Record<string, number>;
  minutes?: number;
  game_date?: string;
  opponent_abbr?: string;
  game?: { scheduled_at?: string; home_team?: { abbreviation?: string }; away_team?: { abbreviation?: string } };
};

// Map a sportsbook prop stat_type onto the key used in player_game_stats.stats
const STAT_KEY: Record<string, string> = {
  batter_hits: "hits",
  batter_total_bases: "total_bases",
  pitcher_strikeouts: "strikeouts",
};
function statKey(t: string) {
  return STAT_KEY[t] ?? t;
}

function odds(v?: number) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}`;
}

function PropsPage() {
  const [sport, setSport] = useState("MLB");
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<string>("");
  const [props, setProps] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statFilter, setStatFilter] = useState("ALL");
  const [side, setSide] = useState<"over" | "under" | "all">("over");
  const [selected, setSelected] = useState<Prop | null>(null);

  // Load games for sport
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/games?sport=${sport}&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        const gs: Game[] = d.data ?? [];
        setGames(gs);
        setGameId(gs[0]?.id ?? "");
        if (!gs.length) { setProps([]); setLoading(false); }
      })
      .catch(() => { setGames([]); setLoading(false); });
  }, [sport]);

  // Load props for selected game
  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setSelected(null);
    fetch(`${API_BASE}/api/games/${gameId}/props`)
      .then((r) => r.json())
      .then((d) => { setProps(d.data ?? []); setLoading(false); })
      .catch(() => { setProps([]); setLoading(false); });
  }, [gameId]);

  const statTypes = useMemo(
    () => ["ALL", ...Array.from(new Set(props.map((p) => p.stat_type).filter(Boolean) as string[]))],
    [props]
  );

  const filtered = useMemo(() => {
    return props
      .filter((p) => (statFilter === "ALL" ? true : p.stat_type === statFilter))
      .filter((p) => (query ? (p.player?.full_name ?? "").toLowerCase().includes(query.toLowerCase()) : true))
      .sort((a, b) => (Number(b.over_prob ?? 0) - Number(a.over_prob ?? 0)));
  }, [props, statFilter, query]);

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Research" title="Props Lab"
        description="Player prop board with hit-rate visualization and secondary-stat overlay across every book."
        right={<Pill tone="helix"><Layers className="size-3" /> {props.length} props</Pill>}
      />

      {/* Sport + game pickers */}
      <div className="flex flex-wrap gap-2">
        {SPORTS.map((s) => (
          <button key={s} onClick={() => setSport(s)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-display uppercase tracking-wider border transition ${sport === s ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
            {s}
          </button>
        ))}
      </div>

      {games.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {games.map((g) => (
            <button key={g.id} onClick={() => setGameId(g.id ?? "")}
              className={`shrink-0 px-3 py-2 rounded-xl text-xs border transition ${gameId === g.id ? "bg-primary/10 border-primary/40 text-foreground" : "border-border/60 text-muted-foreground hover:bg-muted/20"}`}>
              <span className="font-semibold">{g.away_team_abbr ?? g.away_team_name}</span>
              <span className="mx-1 text-muted-foreground/50">@</span>
              <span className="font-semibold">{g.home_team_abbr ?? g.home_team_name}</span>
              <span className="ml-2 text-muted-foreground/60">{g.scheduled_at ? new Date(g.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <Panel className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-muted/30 border border-border min-w-[200px] flex-1">
            <Search className="size-4 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player…"
              className="bg-transparent flex-1 text-sm outline-none placeholder:text-muted-foreground/60" />
          </div>
          <select value={statFilter} onChange={(e) => setStatFilter(e.target.value)}
            className="h-9 bg-muted/30 border border-border rounded-lg px-3 text-sm outline-none focus:border-primary/40">
            {statTypes.map((s) => <option key={s} value={s}>{s === "ALL" ? "All props" : s}</option>)}
          </select>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["over", "all", "under"] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)}
                className={`px-3 h-9 text-xs uppercase tracking-wide transition ${side === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/20"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Props table */}
        <Panel className="lg:col-span-3 !p-0 overflow-hidden">
          <div className="px-5 pt-5">
            <PanelHeader title="Player Props" subtitle={`${filtered.length} shown`} icon={<Target className="size-4" />} />
          </div>
          {loading ? (
            <div className="p-5 space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-11 rounded shimmer bg-muted/30" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No props available for this game yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-y border-border/30 text-muted-foreground/60 uppercase tracking-wider text-[10px]">
                    <th className="text-left px-5 py-2.5">Player</th>
                    <th className="text-left px-3 py-2.5">Prop</th>
                    <th className="text-center px-3 py-2.5">Line</th>
                    <th className="text-center px-3 py-2.5">{side === "under" ? "Under" : "Over"}</th>
                    <th className="text-center px-3 py-2.5">Hit %</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => {
                    const prob = side === "under" ? p.under_prob : p.over_prob;
                    const price = side === "under" ? p.under_price : p.over_price;
                    const hit = prob != null ? Math.round(Number(prob) * 100) : null;
                    const active = selected?.id === p.id;
                    return (
                      <tr key={p.id ?? i} onClick={() => setSelected(p)}
                        className={`border-b border-border/10 cursor-pointer transition ${active ? "bg-primary/10" : "hover:bg-white/[0.02]"}`}>
                        <td className="px-5 py-2.5 font-medium">{p.player?.full_name ?? "—"}<span className="text-muted-foreground/50 ml-1.5">{p.player?.position}</span></td>
                        <td className="px-3 py-2.5 text-muted-foreground capitalize">{(p.stat_type ?? "").replace(/_/g, " ")}</td>
                        <td className="px-3 py-2.5 text-center font-mono-display">{p.line ?? "—"}</td>
                        <td className="px-3 py-2.5 text-center font-mono-display">{odds(price)}</td>
                        <td className="px-3 py-2.5 text-center">
                          {hit != null ? (
                            <span className={`font-mono-display ${hit >= 60 ? "text-emerald" : hit >= 45 ? "text-amber" : "text-crimson"}`}>{hit}%</span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right"><ChevronRight className={`size-3.5 inline ${active ? "text-primary" : "text-muted-foreground/30"}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Detail / hit-rate chart */}
        <div className="lg:col-span-2">
          {selected ? <PropDetail prop={selected} /> : (
            <Panel className="h-full grid place-items-center min-h-[300px]">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="size-9 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm">Select a prop to see its hit-rate chart</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Recent games vs the line, with secondary-stat overlay.</p>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function PropDetail({ prop }: { prop: Prop }) {
  const [recent, setRecent] = useState<RecentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [overlay, setOverlay] = useState<string>("");

  useEffect(() => {
    if (!prop.player_id) return;
    setLoading(true);
    setOverlay("");
    fetch(`${API_BASE}/api/players/${prop.player_id}`)
      .then((r) => r.json())
      .then((d) => { setRecent((d.data?.recentStats ?? []) as RecentStat[]); setLoading(false); })
      .catch(() => { setRecent([]); setLoading(false); });
  }, [prop.player_id]);

  const stat = prop.stat_type ?? "";
  const key = statKey(stat);
  const line = Number(prop.line ?? 0);

  // Build chart series oldest→newest from recent games
  const series = useMemo(() => {
    const rows = [...recent].reverse(); // recentStats arrives newest-first (game_date desc)
    return rows
      .map((r) => {
        const value = Number(r.stats?.[key] ?? NaN);
        if (Number.isNaN(value)) return null;
        const opp = r.opponent_abbr ?? r.game?.away_team?.abbreviation ?? r.game?.home_team?.abbreviation ?? "";
        const dateLabel = r.game_date ? new Date(r.game_date + "T00:00:00").toLocaleDateString([], { month: "numeric", day: "numeric" }) : "";
        const label = opp ? (opp + (dateLabel ? ` ${dateLabel}` : "")) : (dateLabel || "—");
        const overlayVal = overlay ? Number(r.stats?.[overlay] ?? r.minutes ?? NaN) : undefined;
        return { g: label, value, overlay: overlayVal };
      })
      .filter(Boolean) as { g: string; value: number; overlay?: number }[];
  }, [recent, key, overlay]);

  const overlayKeys = useMemo(() => {
    const keys = new Set<string>();
    recent.forEach((r) => Object.keys(r.stats ?? {}).forEach((k) => { if (k !== key) keys.add(k); }));
    return Array.from(keys).slice(0, 12);
  }, [recent, key]);

  const hits = series.filter((s) => s.value >= line).length;
  const hitRate = series.length ? Math.round((hits / series.length) * 100) : null;

  return (
    <Panel className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{prop.player?.full_name}</h3>
          <Pill tone="neon">{prop.player?.position}</Pill>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 capitalize">
          {stat.replace(/_/g, " ")} · line {prop.line} · {prop.sportsbook?.name ?? prop.best_book ?? "best book"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="L10 Hit" value={hitRate != null ? `${hitRate}%` : "—"} accent={hitRate != null && hitRate >= 60 ? "emerald" : "amber"} />
        <Stat label="Over" value={odds(prop.over_price)} accent="neon" />
        <Stat label="Under" value={odds(prop.under_price)} accent="helix" />
      </div>

      {loading ? (
        <div className="h-[240px] rounded shimmer bg-muted/30" />
      ) : series.length === 0 ? (
        <div className="h-[200px] grid place-items-center text-center text-sm text-muted-foreground">
          No recent game logs for this stat yet.
        </div>
      ) : (
        <>
          <HitRateChart data={series} line={line} overlayKey={overlay || undefined} overlayLabel={overlay} />
          {overlayKeys.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Overlay:</span>
              <button onClick={() => setOverlay("")}
                className={`text-[10px] px-2 py-1 rounded border ${!overlay ? "border-primary/40 text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/20"}`}>none</button>
              {overlayKeys.map((k) => (
                <button key={k} onClick={() => setOverlay(k)}
                  className={`text-[10px] px-2 py-1 rounded border capitalize ${overlay === k ? "border-accent/40 text-accent bg-accent/10" : "border-border text-muted-foreground hover:bg-muted/20"}`}>
                  {k.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

void Users;
