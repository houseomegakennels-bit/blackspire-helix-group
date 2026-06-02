import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { LineChart } from "lucide-react";

export const Route = createFileRoute("/_app/markets")({ component: MarketsPage });

type BookLines = { spread?: number; spread_price?: number; moneyline?: number; total?: number; total_price?: number };
type OddsRow = { id?: string; home_team?: string; away_team?: string; sport?: string; scheduled_at?: string; books?: Record<string, BookLines> };

const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "BetRivers"];

function OddsCell({ val, label }: { val?: number | null; label?: string }) {
  if (val == null) return <span className="text-muted-foreground/40">—</span>;
  const isNeg = val < 0;
  return (
    <span className={isNeg ? "text-crimson" : "text-emerald"}>
      {label ? `${label} ` : ""}{isNeg ? "" : "+"}{val}
    </span>
  );
}

function MatchupCard({ o }: { o: OddsRow }) {
  const books = o.books ?? {};
  const availBooks = BOOKS.filter(b => books[b]);
  const time = o.scheduled_at ? new Date(o.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="font-semibold tracking-wide">{o.away_team} <span className="text-muted-foreground/50 mx-1.5">@</span> {o.home_team}</div>
        <div className="flex items-center gap-2">
          {time && <span className="text-xs text-muted-foreground">{time}</span>}
          <Pill tone="neon">{o.sport}</Pill>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/20">
              <th className="text-left px-4 py-2 text-muted-foreground/60 uppercase tracking-wider text-[10px] w-28">Book</th>
              <th className="text-center px-3 py-2 text-muted-foreground/60 uppercase tracking-wider text-[10px]">Spread</th>
              <th className="text-center px-3 py-2 text-muted-foreground/60 uppercase tracking-wider text-[10px]">ML</th>
              <th className="text-center px-3 py-2 text-muted-foreground/60 uppercase tracking-wider text-[10px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {availBooks.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-3 text-center text-muted-foreground/50">No lines yet</td></tr>
            ) : availBooks.map((book) => {
              const b = books[book];
              return (
                <tr key={book} className="border-b border-border/10 hover:bg-white/[0.02] transition">
                  <td className="px-4 py-2 font-medium text-muted-foreground">{book}</td>
                  <td className="px-3 py-2 text-center font-mono-display">
                    {b?.spread != null ? <span>{b.spread > 0 ? "+" : ""}{b.spread} <OddsCell val={b.spread_price} /></span> : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center font-mono-display"><OddsCell val={b?.moneyline} /></td>
                  <td className="px-3 py-2 text-center font-mono-display">
                    {b?.total != null ? <span>o{b.total} <OddsCell val={b.total_price} /></span> : <span className="text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarketsPage() {
  const [odds, setOdds] = useState<OddsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("MLB");
  const SPORTS = ["MLB", "NBA", "NHL", "WNBA"];

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/market/odds?sport=${sport}&limit=20`)
      .then(r => r.json())
      .then(d => { setOdds(d.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sport]);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Markets" title="Odds & Lines" description="Live lines from BetMGM, DraftKings, FanDuel, BetRivers." />
      <div className="flex gap-2">
        {SPORTS.map((s) => (
          <button key={s} onClick={() => setSport(s)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-display uppercase tracking-wider border transition ${sport === s ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
            {s}
          </button>
        ))}
      </div>
      <Panel>
        <PanelHeader
          title="Current Lines"
          subtitle={`${odds.length} matchups`}
          icon={<LineChart className="size-4" />}
          right={<Pill tone="emerald">{sport}</Pill>}
        />
        {loading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-xl shimmer bg-muted/30" />)}</div>
        ) : odds.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No lines available for {sport} right now.</div>
        ) : (
          <div className="space-y-3">
            {odds.map((o, i) => <MatchupCard key={o.id ?? i} o={o} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}
