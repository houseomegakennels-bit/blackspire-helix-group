import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Panel, Pill, SectionTitle, LiveDot } from "@/components/oracle/Primitives";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/_app/markets")({
  head: () => ({ meta: [{ title: "Market Intelligence · Oracle Helix" }] }),
  component: MarketsPage,
});

const SPORTS = ["NFL", "NBA", "MLB", "NHL", "WNBA"] as const;

function MarketsPage() {
  const [sport, setSport] = useState<(typeof SPORTS)[number]>("MLB");

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Market Intelligence"
        title="Read the markets, not the noise."
        description="EV, sharp action, cross-book odds, and arbitrage — all in one place."
        right={<Pill tone="emerald"><LiveDot /> Auto-refresh on</Pill>}
      />

      <Tabs defaultValue="ev" className="space-y-4">
        <TabsList className="bg-muted/40 border border-border/40 h-auto p-1">
          <TabsTrigger value="ev">EV Finder</TabsTrigger>
          <TabsTrigger value="sharp">Sharp Feed</TabsTrigger>
          <TabsTrigger value="odds">Odds Scanner</TabsTrigger>
          <TabsTrigger value="arb">Arbitrage</TabsTrigger>
        </TabsList>

        <TabsContent value="ev"><EVTab /></TabsContent>
        <TabsContent value="sharp"><SharpTab /></TabsContent>
        <TabsContent value="odds">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mr-1">Sport</span>
            {SPORTS.map((s) => (
              <button
                key={s}
                onClick={() => setSport(s)}
                className={
                  "px-2.5 py-1 rounded-md text-[11px] font-mono-display uppercase tracking-wider transition border " +
                  (sport === s
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-muted-foreground hover:text-foreground border-border hover:bg-muted/30")
                }
              >
                {s}
              </button>
            ))}
          </div>
          <OddsTab sport={sport} />
        </TabsContent>
        <TabsContent value="arb"><ArbTab /></TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground/70 text-center pt-2">
        Odds data for informational purposes only. ORACLE HELIX is not a sportsbook. Please gamble responsibly.
      </p>
    </div>
  );
}

// ------- shared hooks / helpers -------

function useApi<T = any>(path: string | null, intervalMs = 60_000) {
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const r = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        const list: T[] = Array.isArray(j) ? j : (j?.data ?? j?.results ?? []);
        setData(list);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    load(true);
    const id = setInterval(() => load(false), intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [path, intervalMs]);

  return { data, loading, error };
}

function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <Panel className="!p-10 text-center">
      <div className="mx-auto size-12 rounded-full bg-muted/40 grid place-items-center mb-3">
        <Inbox className="size-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium">{label}</h3>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </Panel>
  );
}

function fmtAgo(iso?: string) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtOdds(o?: number | null) {
  if (o == null || isNaN(Number(o))) return "—";
  const n = Number(o);
  return n > 0 ? `+${n}` : `${n}`;
}

// ------- EV TAB -------

type EVRow = {
  matchup?: string; market?: string; market_type?: string; selection?: string;
  ev?: number; ev_percent?: number; edge?: number;
  book?: string; sportsbook?: string; odds?: number;
};

function EVTab() {
  const { data, loading, error } = useApi<EVRow>("/api/market/ev", 60_000);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => (Number(b.ev ?? b.ev_percent ?? b.edge ?? 0)) - (Number(a.ev ?? a.ev_percent ?? a.edge ?? 0)));
  }, [data]);

  if (loading) return <Panel><SkeletonRows /></Panel>;
  if (error) return <Panel className="!p-8 text-center text-sm text-crimson">Unable to load EV — {error}</Panel>;
  if (!rows.length) return <EmptyState label="No +EV opportunities right now" hint="The board is efficient. Check back shortly." />;

  const maxEV = Math.max(...rows.map((r) => Number(r.ev ?? r.ev_percent ?? r.edge ?? 0)), 1);

  return (
    <Panel className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-3">Matchup</th>
              <th className="text-left px-4 py-3">Market</th>
              <th className="text-left px-4 py-3">Book</th>
              <th className="text-right px-4 py-3">Odds</th>
              <th className="text-left px-4 py-3 w-[36%]">Edge</th>
              <th className="text-right px-4 py-3">EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ev = Number(r.ev ?? r.ev_percent ?? r.edge ?? 0);
              const pct = Math.max(2, Math.min(100, (ev / maxEV) * 100));
              return (
                <tr key={i} className="border-t border-border/40 hover:bg-muted/10">
                  <td className="px-4 py-3 font-medium truncate max-w-[220px]">{r.matchup || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.market || r.market_type || r.selection || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.book || r.sportsbook || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono-display">{fmtOdds(r.odds)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full bg-emerald" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Pill tone="emerald">+EV {ev.toFixed(2)}%</Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ------- SHARP TAB -------

type SharpSignal = {
  id?: string | number;
  sport?: string;
  team?: string; team_abbr?: string;
  signal?: string; signal_type?: string; type?: string;
  magnitude?: number; strength?: number;
  created_at?: string; timestamp?: string;
  matchup?: string;
};

const SPORT_TONE: Record<string, string> = {
  NBA: "border-amber/40 text-amber bg-amber/10",
  NFL: "border-emerald/40 text-emerald bg-emerald/10",
  MLB: "border-primary/40 text-primary bg-primary/10",
  NHL: "border-cyan-500/40 text-cyan-300 bg-cyan-500/10",
  WNBA: "border-accent/40 text-accent bg-accent/10",
};

function SharpTab() {
  const { data, loading, error } = useApi<SharpSignal>("/api/market/sharp", 30_000);

  if (loading) return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => <Panel key={i}><SkeletonRows rows={3} /></Panel>)}
    </div>
  );
  if (error) return <Panel className="!p-8 text-center text-sm text-crimson">Unable to load sharp feed — {error}</Panel>;
  if (!data?.length) return <EmptyState label="No sharp action detected" hint="The board is quiet. Auto-refreshing every 30s." />;

  const max = Math.max(...data.map((s) => Number(s.magnitude ?? s.strength ?? 0)), 1);

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.map((s, i) => {
        const mag = Number(s.magnitude ?? s.strength ?? 0);
        const pct = Math.max(4, Math.min(100, (mag / max) * 100));
        const sport = (s.sport || "").toUpperCase();
        return (
          <Panel key={String(s.id ?? i)} className="hover:border-crimson/40 transition">
            <div className="flex items-center justify-between mb-3">
              <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " + (SPORT_TONE[sport] || "border-border text-muted-foreground bg-muted/30")}>
                {sport || "—"}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono-display uppercase tracking-wider text-crimson">
                <LiveDot tone="crimson" /> Sharp
              </span>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold">{s.team_abbr || s.team || s.matchup || "—"}</div>
              <div className="text-xs text-muted-foreground">{s.signal_type || s.signal || s.type || "Signal"}</div>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                <span>Magnitude</span>
                <span className="font-mono-display text-crimson">{mag.toFixed(1)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full bg-crimson" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="mt-3 text-[10px] text-muted-foreground font-mono-display">{fmtAgo(s.created_at || s.timestamp)}</div>
          </Panel>
        );
      })}
    </div>
  );
}

// ------- ODDS SCANNER TAB -------

type OddsRow = {
  game_id?: string | number; matchup?: string;
  home_team?: string; away_team?: string;
  home_team_abbr?: string; away_team_abbr?: string;
  books?: Record<string, { spread?: number; total?: number; moneyline?: number; spread_price?: number; total_price?: number }>;
  markets?: Record<string, Record<string, number>>;
};

function OddsTab({ sport }: { sport: string }) {
  const [view, setView] = useState<"spread" | "total" | "ml">("spread");
  const { data, loading, error } = useApi<OddsRow>(`/api/market/odds?sport=${sport}`, 60_000);

  const books = useMemo(() => {
    const set = new Set<string>();
    (data || []).forEach((g) => Object.keys(g.books || g.markets || {}).forEach((b) => set.add(b)));
    return Array.from(set);
  }, [data]);

  const cellValue = (row: OddsRow, book: string): number | null => {
    const b: any = row.books?.[book] ?? row.markets?.[book];
    if (!b) return null;
    if (view === "spread") return b.spread ?? b.spread_price ?? null;
    if (view === "total") return b.total ?? b.total_price ?? null;
    return b.moneyline ?? b.ml ?? null;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {([["spread", "Spreads"], ["total", "Totals"], ["ml", "Moneylines"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={
              "px-3 py-1 rounded-md text-[11px] font-mono-display uppercase tracking-wider transition border " +
              (view === k
                ? "bg-primary/15 text-primary border-primary/30"
                : "text-muted-foreground hover:text-foreground border-border hover:bg-muted/30")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Panel><SkeletonRows /></Panel>
      ) : error ? (
        <Panel className="!p-8 text-center text-sm text-crimson">Unable to load odds — {error}</Panel>
      ) : !data?.length || !books.length ? (
        <EmptyState label="No odds available" hint={`No ${sport} markets currently available.`} />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-3 sticky left-0 bg-muted/20">Game</th>
                  {books.map((b) => <th key={b} className="text-right px-3 py-3">{b}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.map((g, i) => {
                  const vals = books.map((b) => cellValue(g, b)).filter((v): v is number => v != null);
                  const best = view === "ml" ? Math.max(...vals) : Math.max(...vals);
                  return (
                    <tr key={String(g.game_id ?? i)} className="border-t border-border/40 hover:bg-muted/10">
                      <td className="px-4 py-3 font-medium sticky left-0 bg-background/80 backdrop-blur whitespace-nowrap">
                        {g.away_team_abbr || g.away_team || "Away"} @ {g.home_team_abbr || g.home_team || "Home"}
                      </td>
                      {books.map((b) => {
                        const v = cellValue(g, b);
                        const isBest = v != null && v === best;
                        return (
                          <td key={b} className={"text-right px-3 py-3 font-mono-display text-xs " + (isBest ? "text-emerald font-semibold" : "text-muted-foreground")}>
                            {v == null ? "—" : view === "ml" ? fmtOdds(v) : v}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ------- ARBITRAGE TAB -------

type ArbRow = {
  id?: string | number;
  matchup?: string;
  book_a?: string; book_b?: string;
  side_a?: string; side_b?: string;
  odds_a?: number; odds_b?: number;
  profit?: number; profit_percent?: number; margin?: number;
};

function ArbTab() {
  const { data, loading, error } = useApi<ArbRow>("/api/market/arbitrage", 60_000);

  if (loading) return <Panel><SkeletonRows /></Panel>;
  if (error) return <Panel className="!p-8 text-center text-sm text-crimson">Unable to load arbitrage — {error}</Panel>;
  if (!data?.length) return <EmptyState label="No arbitrage opportunities" hint="Cross-book pricing is currently aligned. Auto-refreshing every 60s." />;

  return (
    <Panel className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-3">Matchup</th>
              <th className="text-left px-4 py-3">Book A</th>
              <th className="text-left px-4 py-3">Book B</th>
              <th className="text-right px-4 py-3">Odds A</th>
              <th className="text-right px-4 py-3">Odds B</th>
              <th className="text-right px-4 py-3">Guaranteed Profit</th>
              <th className="text-right px-4 py-3">Tag</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
              const profit = Number(r.profit ?? r.profit_percent ?? r.margin ?? 0);
              return (
                <tr key={String(r.id ?? i)} className="border-t border-border/40 bg-emerald/[0.04] hover:bg-emerald/[0.08]">
                  <td className="px-4 py-3 font-medium">{r.matchup || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.book_a || "—"} {r.side_a && <span className="text-foreground/70">· {r.side_a}</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.book_b || "—"} {r.side_b && <span className="text-foreground/70">· {r.side_b}</span>}</td>
                  <td className="px-4 py-3 text-right font-mono-display">{fmtOdds(r.odds_a)}</td>
                  <td className="px-4 py-3 text-right font-mono-display">{fmtOdds(r.odds_b)}</td>
                  <td className="px-4 py-3 text-right text-emerald font-mono-display font-semibold">+{profit.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right"><Pill tone="emerald">ARB</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
