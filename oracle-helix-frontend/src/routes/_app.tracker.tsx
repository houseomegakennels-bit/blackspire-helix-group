import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, PanelHeader, Pill, SectionTitle } from "@/components/oracle/Primitives";
import { Wallet, Plus, Trash2, TrendingUp, TrendingDown, Target, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_app/tracker")({ component: TrackerPage });

type Bet = { id: string; date: string; sport: string; matchup: string; bet: string; odds: number; units: number; result: "win" | "loss" | "push" | "pending"; notes?: string };

const STORAGE_KEY = "oracle_helix_bets";

function genId() { return Math.random().toString(36).slice(2, 10); }

function calcROI(bets: Bet[]) {
  const settled = bets.filter(b => b.result !== "pending");
  if (!settled.length) return { roi: 0, totalUnits: 0, wonUnits: 0, record: { w: 0, l: 0, p: 0 } };
  let won = 0, record = { w: 0, l: 0, p: 0 };
  const totalUnits = settled.reduce((a, b) => a + b.units, 0);
  for (const b of settled) {
    if (b.result === "win") { won += b.units * (b.odds > 0 ? b.odds / 100 : 100 / Math.abs(b.odds)); record.w++; }
    else if (b.result === "loss") { won -= b.units; record.l++; }
    else record.p++;
  }
  return { roi: totalUnits ? (won / totalUnits) * 100 : 0, wonUnits: won, totalUnits, record };
}

const SPORTS = ["MLB", "NBA", "NHL", "WNBA", "NFL"];

function TrackerPage() {
  const [bets, setBets] = useState<Bet[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sport: "MLB", matchup: "", bet: "", odds: "-110", units: "1", notes: "" });

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(bets)); }, [bets]);

  const addBet = () => {
    const odds = parseInt(form.odds) || -110;
    const units = parseFloat(form.units) || 1;
    if (!form.matchup.trim() || !form.bet.trim()) return;
    const newBet: Bet = { id: genId(), date: new Date().toISOString().split("T")[0], sport: form.sport, matchup: form.matchup, bet: form.bet, odds, units, result: "pending", notes: form.notes };
    setBets(prev => [newBet, ...prev]);
    setForm({ sport: "MLB", matchup: "", bet: "", odds: "-110", units: "1", notes: "" });
    setShowForm(false);
  };

  const setResult = (id: string, result: Bet["result"]) => setBets(prev => prev.map(b => b.id === id ? { ...b, result } : b));
  const remove = (id: string) => setBets(prev => prev.filter(b => b.id !== id));

  const stats = calcROI(bets);
  const pending = bets.filter(b => b.result === "pending");
  const settled = bets.filter(b => b.result !== "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionTitle eyebrow="Tracker" title="Bet Tracker" description="Track your wagers, ROI, and unit history. Stored locally." />
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 bg-gradient-helix text-background text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition">
          <Plus className="size-3.5" /> Add Bet
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Record", value: `${stats.record.w}-${stats.record.l}-${stats.record.p}`, icon: <Target className="size-4" />, accent: "neon" },
          { label: "Units Won", value: `${stats.wonUnits >= 0 ? "+" : ""}${stats.wonUnits.toFixed(2)}u`, icon: <DollarSign className="size-4" />, accent: stats.wonUnits >= 0 ? "emerald" : "crimson" },
          { label: "ROI", value: `${stats.roi >= 0 ? "+" : ""}${stats.roi.toFixed(1)}%`, icon: stats.roi >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />, accent: stats.roi >= 0 ? "emerald" : "crimson" },
          { label: "Pending", value: pending.length, icon: <Wallet className="size-4" />, accent: "helix" },
        ].map(stat => (
          <Panel key={stat.label} className="!p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</div>
              <div className={stat.accent === "neon" ? "text-neon" : stat.accent === "emerald" ? "text-emerald" : stat.accent === "crimson" ? "text-crimson" : "text-helix"}>{stat.icon}</div>
            </div>
            <div className="mt-2 text-2xl font-mono-display font-bold">{stat.value}</div>
          </Panel>
        ))}
      </div>

      {/* Add Bet Form */}
      {showForm && (
        <Panel>
          <PanelHeader title="New Bet" icon={<Plus className="size-4" />} />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Sport</label>
              <select value={form.sport} onChange={e => setForm(p => ({ ...p, sport: e.target.value }))}
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40">
                {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Matchup</label>
              <input value={form.matchup} onChange={e => setForm(p => ({ ...p, matchup: e.target.value }))} placeholder="ATL @ CIN"
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40" />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Bet Description</label>
              <input value={form.bet} onChange={e => setForm(p => ({ ...p, bet: e.target.value }))} placeholder="CIN ML / ATL -1.5 / Total o9"
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Odds (American)</label>
              <input value={form.odds} onChange={e => setForm(p => ({ ...p, odds: e.target.value }))} placeholder="-110"
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Units</label>
              <input value={form.units} onChange={e => setForm(p => ({ ...p, units: e.target.value }))} placeholder="1"
                className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40" type="number" min="0.1" step="0.1" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addBet} className="bg-gradient-helix text-background text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition">Add</button>
            <button onClick={() => setShowForm(false)} className="border border-border/40 text-sm px-4 py-2 rounded-xl hover:bg-muted/20 transition">Cancel</button>
          </div>
        </Panel>
      )}

      {/* Pending Bets */}
      {pending.length > 0 && (
        <Panel>
          <PanelHeader title="Pending" subtitle={`${pending.length} open`} icon={<Wallet className="size-4" />} right={<Pill tone="helix">OPEN</Pill>} />
          <div className="space-y-2 mt-1">
            {pending.map(b => (
              <div key={b.id} className="flex items-center gap-3 glass rounded-xl p-3">
                <Pill tone="neon" className="shrink-0">{b.sport}</Pill>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{b.matchup}</div>
                  <div className="text-[11px] text-muted-foreground">{b.bet} · {b.odds > 0 ? "+" : ""}{b.odds} · {b.units}u</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {(["win","loss","push"] as const).map(r => (
                    <button key={r} onClick={() => setResult(b.id, r)}
                      className={`text-[10px] uppercase px-2 py-1 rounded-lg border transition ${r === "win" ? "border-emerald/40 text-emerald hover:bg-emerald/10" : r === "loss" ? "border-crimson/40 text-crimson hover:bg-crimson/10" : "border-border/40 text-muted-foreground hover:bg-muted/20"}`}>
                      {r}
                    </button>
                  ))}
                  <button onClick={() => remove(b.id)} className="text-muted-foreground/40 hover:text-crimson transition ml-1"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Settled Bets */}
      {settled.length > 0 && (
        <Panel>
          <PanelHeader title="History" subtitle={`${settled.length} settled`} icon={<TrendingUp className="size-4" />} />
          <div className="space-y-2 mt-1">
            {settled.slice(0, 20).map(b => (
              <div key={b.id} className={`flex items-center gap-3 rounded-xl p-3 border ${b.result === "win" ? "border-emerald/20 bg-emerald/5" : b.result === "loss" ? "border-crimson/20 bg-crimson/5" : "border-border/20 bg-muted/10"}`}>
                <Pill tone={b.result === "win" ? "emerald" : b.result === "loss" ? "crimson" : "neon"} className="shrink-0 uppercase">{b.result}</Pill>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{b.matchup} — {b.bet}</div>
                  <div className="text-[11px] text-muted-foreground">{b.sport} · {b.date} · {b.odds > 0 ? "+" : ""}{b.odds} · {b.units}u</div>
                </div>
                <button onClick={() => remove(b.id)} className="text-muted-foreground/30 hover:text-crimson transition"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {bets.length === 0 && !showForm && (
        <Panel>
          <div className="flex flex-col items-center py-12 gap-4 text-center">
            <Wallet className="size-10 text-muted-foreground/30" />
            <div>
              <p className="font-medium">No bets tracked yet</p>
              <p className="text-sm text-muted-foreground mt-1">Click "Add Bet" to start logging your wagers.</p>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}