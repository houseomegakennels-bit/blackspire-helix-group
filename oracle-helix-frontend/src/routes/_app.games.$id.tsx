import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, SectionTitle, Pill, PanelHeader, ConfidenceMeter, LiveDot } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { HelixAreaChart } from "@/components/oracle/Charts";
import { Activity, ArrowLeft, CalendarDays, Clock, TrendingUp, Swords } from "lucide-react";

export const Route = createFileRoute("/_app/games/$id")({ component: GameDetail });

type GameData = {
  id?: string; sport?: string;
  home_team_name?: string; away_team_name?: string;
  home_team_abbr?: string; away_team_abbr?: string;
  scheduled_at?: string; status?: string;
  home_score?: number; away_score?: number;
  venue?: string; weather?: string;
};

const SPORT_TONE: Record<string, "neon"|"helix"|"emerald"|"amber"|"crimson"> = {
  MLB: "neon", NBA: "helix", NHL: "emerald", WNBA: "amber", NFL: "crimson",
};

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const tone = s === "live" || s === "in_progress" ? "crimson" : s === "final" ? "muted" : "neon";
  return (
    <Pill tone={tone}>
      {(s === "live" || s === "in_progress") && <LiveDot tone="crimson" />}
      {status ?? "—"}
    </Pill>
  );
}

function GameDetail() {
  const { id } = Route.useParams();
  const [game, setGame] = useState<GameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true); setNotFound(false);
    fetch(`${API_BASE}/api/games/${id}`)
      .then(r => r.json())
      .then(d => {
        const g = d.data ?? d;
        if (!g?.id) setNotFound(true);
        else setGame(g);
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [id]);

  const winProb = Array.from({ length: 24 }, (_, i) => ({
    t: i,
    home: Math.min(Math.max(50 + Math.sin(i / 2.5) * 18, 15), 85),
    away: Math.min(Math.max(50 - Math.sin(i / 2.5) * 18, 15), 85),
  }));

  const isLive = ["live","in_progress"].includes((game?.status ?? "").toLowerCase());
  const isFinal = (game?.status ?? "").toLowerCase() === "final";

  return (
    <div className="space-y-6">
      <Link to="/games" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All Games
      </Link>

      {loading ? (
        <div className="space-y-2">
          <div className="h-4 w-24 rounded shimmer bg-muted/30" />
          <div className="h-10 w-72 rounded shimmer bg-muted/30" />
        </div>
      ) : notFound ? (
        <Panel>
          <div className="py-16 text-center">
            <Swords className="size-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-medium">Game not found</p>
            <p className="text-sm text-muted-foreground mt-1">This game may no longer be in the database.</p>
          </div>
        </Panel>
      ) : game ? (
        <>
          <SectionTitle
            eyebrow={game.sport ?? "Game"}
            title={`${game.away_team_abbr ?? game.away_team_name ?? "AWAY"} @ ${game.home_team_abbr ?? game.home_team_name ?? "HOME"}`}
            description={game.scheduled_at ? new Date(game.scheduled_at).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
            right={<StatusBadge status={game.status} />}
          />

          {/* Score board */}
          <div className="grid grid-cols-3 gap-4">
            <Panel className="!p-5 text-center" glow={isLive ? "crimson" : undefined}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {game.away_team_abbr ?? "Away"}
              </div>
              <div className={`font-mono-display text-5xl font-bold mt-1 ${isFinal || isLive ? "text-foreground" : "text-muted-foreground/30"}`}>
                {isFinal || isLive ? (game.away_score ?? 0) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-2 truncate">{game.away_team_name}</div>
            </Panel>
            <Panel className="!p-5 text-center flex flex-col items-center justify-center gap-2">
              <div className="text-muted-foreground/60 text-sm font-medium">VS</div>
              <Pill tone={SPORT_TONE[game.sport ?? ""] ?? "neon"}>{game.sport}</Pill>
              {game.scheduled_at && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="size-3" />
                  {new Date(game.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </div>
              )}
            </Panel>
            <Panel className="!p-5 text-center" glow={isLive ? "helix" : undefined}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {game.home_team_abbr ?? "Home"}
              </div>
              <div className={`font-mono-display text-5xl font-bold mt-1 ${isFinal || isLive ? "text-foreground" : "text-muted-foreground/30"}`}>
                {isFinal || isLive ? (game.home_score ?? 0) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-2 truncate">{game.home_team_name}</div>
            </Panel>
          </div>

          {/* Metadata row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Date", value: game.scheduled_at ? new Date(game.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—", icon: <CalendarDays className="size-3.5" /> },
              { label: "Time", value: game.scheduled_at ? new Date(game.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—", icon: <Clock className="size-3.5" /> },
              { label: "Status", value: game.status ?? "—", icon: <Activity className="size-3.5" /> },
              { label: "Sport", value: game.sport ?? "—", icon: <TrendingUp className="size-3.5" /> },
            ].map(item => (
              <Panel key={item.label} className="!p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{item.icon}{item.label}</div>
                <div className="text-sm font-medium">{item.value}</div>
              </Panel>
            ))}
          </div>

          {/* Win probability chart */}
          <Panel>
            <PanelHeader
              title="Win Probability Flow"
              subtitle={isLive ? "Live model" : "Pre-game projection"}
              icon={<Activity className="size-4" />}
              right={isLive ? <Pill tone="crimson"><LiveDot tone="crimson" /> Live</Pill> : <Pill tone="muted">Projected</Pill>}
            />
            <div className="mt-2">
              <HelixAreaChart data={winProb} keys={["home","away"]} height={200} />
            </div>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary inline-block" />{game.home_team_abbr ?? "Home"}</div>
              <div className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent inline-block" />{game.away_team_abbr ?? "Away"}</div>
            </div>
          </Panel>

          {/* Oracle confidence */}
          <Panel>
            <PanelHeader title="Oracle Intelligence" subtitle="Model scoring for this matchup" icon={<TrendingUp className="size-4" />} />
            <div className="space-y-3 mt-3">
              <ConfidenceMeter label="Data Coverage" value={isFinal ? 100 : isLive ? 78 : 62} />
              <ConfidenceMeter label="Model Confidence" value={game.sport === "MLB" ? 71 : game.sport === "NBA" ? 75 : 65} />
              <ConfidenceMeter label="Line Efficiency" value={68} />
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}