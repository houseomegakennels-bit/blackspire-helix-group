import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle, ConfidenceMeter } from "@/components/oracle/Primitives";
import { HelixBarChart } from "@/components/oracle/Charts";
import { API_BASE } from "@/lib/api";
import { Radar, Flame, Activity } from "lucide-react";

export const Route = createFileRoute("/_app/sharp")({ component: SharpPage });

const SPORTS = ["ALL", "MLB", "NBA", "WNBA", "NHL"];

type Signal = {
  id?: string; signal_type?: string; confidence?: number; magnitude?: number;
  description?: string; team?: string; team_abbr?: string; matchup?: string;
  sport?: string; created_at?: string; triggered_at?: string;
};

const SIGNAL_LABEL: Record<string, string> = {
  steam_move: "Steam Move",
  reverse_line: "Reverse Line",
  sharp_fade: "Sharp Fade",
  wiseguy: "Wiseguy",
};

function label(t?: string) {
  if (!t) return "Signal";
  return SIGNAL_LABEL[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function timeAgo(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SharpPage() {
  const [sport, setSport] = useState("ALL");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = sport === "ALL" ? "" : `?sport=${sport}`;
    fetch(`${API_BASE}/api/market/sharp${q}`)
      .then((r) => r.json())
      .then((d) => { setSignals(d.data ?? []); setLoading(false); })
      .catch(() => { setSignals([]); setLoading(false); });
  }, [sport]);

  const byType = useMemo(() => {
    const counts = new Map<string, number>();
    signals.forEach((s) => counts.set(label(s.signal_type), (counts.get(label(s.signal_type)) ?? 0) + 1));
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }, [signals]);

  const avgConf = signals.length
    ? Math.round((signals.reduce((a, s) => a + Number(s.confidence ?? s.magnitude ?? 0), 0) / signals.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Intelligence" title="Sharp & Streaks"
        description="Steam moves, reverse-line movement and sharp money signals across the board."
        right={<Pill tone="crimson"><Flame className="size-3" /> {signals.length} signals</Pill>}
      />

      <div className="flex flex-wrap gap-2">
        {SPORTS.map((s) => (
          <button key={s} onClick={() => setSport(s)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono-display uppercase tracking-wider border transition ${sport === s ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Signal feed */}
        <Panel className="lg:col-span-3">
          <PanelHeader title="Live Signal Feed" subtitle={`${signals.length} in last 24h`} icon={<Radar className="size-4" />} />
          {loading ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded shimmer bg-muted/30" />)}</div>
          ) : signals.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No sharp signals triggered recently.</div>
          ) : (
            <div className="space-y-2.5">
              {signals.map((s, i) => {
                const conf = Math.round(Number(s.confidence ?? s.magnitude ?? 0) * 100);
                return (
                  <div key={s.id ?? i} className="glass rounded-xl p-3.5">
                    <div className="flex items-center gap-2.5 mb-2">
                      <Pill tone="crimson">{label(s.signal_type)}</Pill>
                      <span className="text-sm font-semibold">{s.matchup ?? s.team ?? "—"}</span>
                      {s.sport && <Pill tone="muted">{s.sport}</Pill>}
                      <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(s.triggered_at ?? s.created_at)}</span>
                    </div>
                    {s.description && <p className="text-xs text-muted-foreground mb-2">{s.description}</p>}
                    <ConfidenceMeter value={conf} label="Confidence" />
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Sidebar: breakdown + avg */}
        <div className="lg:col-span-2 space-y-6">
          <Panel>
            <PanelHeader title="Signal Mix" subtitle="By type" icon={<Activity className="size-4" />} />
            {loading ? <div className="h-[180px] rounded shimmer bg-muted/30" /> :
              byType.length === 0 ? <div className="h-[180px] grid place-items-center text-sm text-muted-foreground">No data</div> :
              <HelixBarChart data={byType} dataKey="count" />}
          </Panel>
          <Panel>
            <PanelHeader title="Average Confidence" icon={<Flame className="size-4" />} />
            <div className="text-4xl font-mono-display font-bold text-crimson mb-3">{avgConf}%</div>
            <ConfidenceMeter value={avgConf} />
            <p className="text-xs text-muted-foreground mt-3">Across all {signals.length} active signals in the selected scope.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
