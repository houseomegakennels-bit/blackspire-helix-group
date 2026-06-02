import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, PanelHeader, Pill, LiveDot, SectionTitle } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { Swords, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_app/games")({ component: GamesPage });

type Game = { id?: string; sport?: string; home_team_name?: string; away_team_name?: string; home_team_abbr?: string; away_team_abbr?: string; scheduled_at?: string; status?: string; home_score?: number; away_score?: number };

function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("ALL");

  useEffect(() => {
    const url = sport === "ALL" ? `${API_BASE}/api/games?limit=50` : `${API_BASE}/api/games?sport=${sport}&limit=50`;
    fetch(url).then(r => r.json()).then(d => { setGames(d.data ?? []); setLoading(false); });
  }, [sport]);

  const SPORTS = ["ALL","NBA","NFL","MLB","NHL","WNBA"];

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Games" title="Today's Matchups" description="Live scores and scheduled games across all sports." />
      <div className="flex gap-2 flex-wrap">
        {SPORTS.map(s => (
          <button key={s} onClick={() => setSport(s)} className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-display uppercase tracking-wider transition border ${sport === s ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>{s}</button>
        ))}
      </div>
      <Panel>
        <PanelHeader title="Matchups" subtitle={`${games.length} games`} icon={<Swords className="size-4" />} right={<Pill tone="emerald"><LiveDot /> Live</Pill>} />
        {loading ? <div className="space-y-3">{[...Array(6)].map((_,i) => <div key={i} className="h-14 rounded shimmer bg-muted/30" />)}</div> : (
          <ul className="divide-y divide-border/60">
            {games.map((g, i) => (
              <li key={g.id ?? i} className="py-3 flex items-center gap-4">
                <Pill tone="neon">{g.sport}</Pill>
                <div className="flex-1 font-medium text-sm">
                  <span className="text-muted-foreground">{g.away_team_abbr ?? g.away_team_name}</span>
                  <span className="mx-2 text-muted-foreground/50">@</span>
                  <span>{g.home_team_abbr ?? g.home_team_name}</span>
                  {g.home_score !== null && g.away_score !== null && g.home_score !== undefined && (
                    <span className="ml-3 text-emerald font-mono-display">{g.away_score} – {g.home_score}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{g.scheduled_at ? new Date(g.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}</div>
                <Link to="/games/$id" params={{ id: g.id ?? "" }} className="text-muted-foreground/40 hover:text-primary"><ArrowRight className="size-4" /></Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
