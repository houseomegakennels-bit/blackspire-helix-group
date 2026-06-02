import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle } from "@/components/oracle/Primitives";
import { EVBars } from "@/components/oracle/Charts";
import { API_BASE } from "@/lib/api";
import { Zap, Scale, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_app/edge")({ component: EdgePage });

const SPORTS = ["ALL", "MLB", "NBA", "WNBA", "NHL"];

type EvRow = {
  id?: string; sport?: string; matchup?: string; market?: string; selection?: string;
  ev_percent?: number; odds?: number; book?: string; line?: number;
};
type ArbRow = {
  id?: string; sport?: string; matchup?: string; book_a?: string; book_b?: string;
  side_a?: string; side_b?: string; odds_a?: number; odds_b?: number; profit_percent?: number;
};

function odds(v?: number) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}`;
}

function EdgePage() {
  const [sport, setSport] = useState("ALL");
  const [ev, setEv] = useState<EvRow[]>([]);
  const [arb, setArb] = useState<ArbRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = sport === "ALL" ? "" : `?sport=${sport}`;
    Promise.all([
      fetch(`${API_BASE}/api/market/ev${q}`).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch(`${API_BASE}/api/market/arbitrage`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([evRes, arbRes]) => {
      setEv(evRes.data ?? []);
      setArb((arbRes.data ?? []).filter((a: ArbRow) => sport === "ALL" || a.sport === sport));
      setLoading(false);
    });
  }, [sport]);

  const chartData = useMemo(
    () => ev.slice(0, 10).map((e) => ({
      name: `${e.selection ?? e.matchup ?? "—"}`.slice(0, 16),
      ev: e.ev_percent != null ? Number(Number(e.ev_percent).toFixed(2)) : 0,
    })),
    [ev]
  );

  const bestEv = ev[0]?.ev_percent != null ? `+${Number(ev[0].ev_percent).toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Markets" title="Edge Finder"
        description="Positive expected-value plays and cross-book arbitrage, ranked by edge."
        right={<Pill tone="emerald"><TrendingUp className="size-3" /> Best EV {bestEv}</Pill>}
      />

      <div className="flex flex-wrap gap-2">
        {SPORTS.map((s) => (
          <button key={s} onClick={() => setSport(s)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-display uppercase tracking-wider border transition ${sport === s ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
            {s}
          </button>
        ))}
      </div>

      {/* EV chart + table */}
      <div className="grid lg:grid-cols-5 gap-6">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Top Edges" subtitle="Ranked by EV %" icon={<Zap className="size-4" />} />
          {loading ? <div className="h-[260px] rounded shimmer bg-muted/30" /> :
            chartData.length === 0 ? <div className="h-[260px] grid place-items-center text-sm text-muted-foreground">No +EV plays right now.</div> :
            <EVBars data={chartData} />}
        </Panel>

        <Panel className="lg:col-span-3 !p-0 overflow-hidden">
          <div className="px-5 pt-5"><PanelHeader title="+EV Opportunities" subtitle={`${ev.length} found`} icon={<TrendingUp className="size-4" />} /></div>
          {loading ? (
            <div className="p-5 space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-10 rounded shimmer bg-muted/30" />)}</div>
          ) : ev.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">No positive-EV opportunities at the moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-y border-border/30 text-muted-foreground/60 uppercase tracking-wider text-[10px]">
                    <th className="text-left px-5 py-2.5">Matchup</th>
                    <th className="text-left px-3 py-2.5">Selection</th>
                    <th className="text-center px-3 py-2.5">Book</th>
                    <th className="text-center px-3 py-2.5">Odds</th>
                    <th className="text-center px-3 py-2.5">EV</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.map((e, i) => (
                    <tr key={e.id ?? i} className="border-b border-border/10 hover:bg-white/[0.02]">
                      <td className="px-5 py-2.5">{e.matchup ?? "—"} {e.sport && <Pill tone="muted" className="ml-1">{e.sport}</Pill>}</td>
                      <td className="px-3 py-2.5 text-muted-foreground capitalize">{e.selection ?? e.market}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">{e.book ?? "—"}</td>
                      <td className="px-3 py-2.5 text-center font-mono-display">{odds(e.odds)}</td>
                      <td className="px-3 py-2.5 text-center font-mono-display text-emerald">
                        {e.ev_percent != null ? `+${Number(e.ev_percent).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* Arbitrage */}
      <Panel className="!p-0 overflow-hidden">
        <div className="px-5 pt-5"><PanelHeader title="Arbitrage" subtitle={`${arb.length} active`} icon={<Scale className="size-4" />} right={<Pill tone="amber">Risk-free</Pill>} /></div>
        {loading ? (
          <div className="p-5 space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded shimmer bg-muted/30" />)}</div>
        ) : arb.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No arbitrage opportunities detected.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-y border-border/30 text-muted-foreground/60 uppercase tracking-wider text-[10px]">
                  <th className="text-left px-5 py-2.5">Matchup</th>
                  <th className="text-left px-3 py-2.5">Side A</th>
                  <th className="text-center px-3 py-2.5">Odds</th>
                  <th className="text-left px-3 py-2.5">Side B</th>
                  <th className="text-center px-3 py-2.5">Odds</th>
                  <th className="text-center px-3 py-2.5">Profit</th>
                </tr>
              </thead>
              <tbody>
                {arb.map((a, i) => (
                  <tr key={a.id ?? i} className="border-b border-border/10 hover:bg-white/[0.02]">
                    <td className="px-5 py-2.5">{a.matchup ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{a.side_a ?? "—"} <span className="text-muted-foreground/50">· {a.book_a}</span></td>
                    <td className="px-3 py-2.5 text-center font-mono-display">{odds(a.odds_a)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{a.side_b ?? "—"} <span className="text-muted-foreground/50">· {a.book_b}</span></td>
                    <td className="px-3 py-2.5 text-center font-mono-display">{odds(a.odds_b)}</td>
                    <td className="px-3 py-2.5 text-center font-mono-display text-emerald">
                      {a.profit_percent != null ? `+${Number(a.profit_percent).toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
