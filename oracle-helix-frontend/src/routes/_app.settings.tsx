import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Panel, PanelHeader, SectionTitle, Pill, ConfidenceMeter } from "@/components/oracle/Primitives";
import { API_BASE } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  Settings, User, Bell, Shield, Database, Zap,
  Check, RefreshCw, Wifi, WifiOff, Moon, Sun, Monitor,
} from "lucide-react";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

const PREFS_KEY = "oracle_helix_prefs";

type Prefs = {
  defaultSport: string;
  defaultUnits: string;
  refreshInterval: number;
  notifications: { sharpSignals: boolean; injuries: boolean; evSpots: boolean };
  theme: "system" | "dark" | "light";
};

function loadPrefs(): Prefs {
  try { return { ...defaultPrefs(), ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return defaultPrefs(); }
}
function defaultPrefs(): Prefs {
  return {
    defaultSport: "MLB",
    defaultUnits: "1",
    refreshInterval: 90,
    notifications: { sharpSignals: true, injuries: true, evSpots: true },
    theme: "system",
  };
}

type ApiHealth = { latency: number | null; ok: boolean; label: string };

function SettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [saved, setSaved] = useState(false);
  const [user, setUser] = useState<{ email?: string; id?: string } | null>(null);
  const [health, setHealth] = useState<ApiHealth>({ latency: null, ok: false, label: "Checking…" });
  const [pinging, setPinging] = useState(false);

  // Load user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
  }, []);

  // Persist prefs
  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  // Check API health once on mount
  useEffect(() => { pingApi(); }, []);

  const pingApi = async () => {
    setPinging(true);
    const start = Date.now();
    try {
      await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
      setHealth({ latency: Date.now() - start, ok: true, label: "Connected" });
    } catch {
      setHealth({ latency: null, ok: false, label: "Unreachable" });
    } finally { setPinging(false); }
  };

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs(p => ({ ...p, [k]: v }));

  const handleSave = () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const SPORTS = ["MLB", "NBA", "NHL", "WNBA", "NFL"];
  const INTERVALS = [{ label: "30 sec", value: 30 }, { label: "1 min", value: 60 }, { label: "90 sec", value: 90 }, { label: "5 min", value: 300 }];

  return (
    <div className="space-y-6 max-w-3xl">
      <SectionTitle eyebrow="Settings" title="Account & Preferences" description="Customize Oracle Helix to match your workflow." />

      {/* Account */}
      <Panel>
        <PanelHeader title="Account" icon={<User className="size-4" />} />
        <div className="space-y-3 mt-1">
          <div className="flex items-center justify-between py-3 border-b border-border/40">
            <div>
              <div className="text-sm font-medium">Email</div>
              <div className="text-xs text-muted-foreground mt-0.5">{user?.email ?? "Not signed in"}</div>
            </div>
            <Pill tone="helix">Analyst</Pill>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border/40">
            <div>
              <div className="text-sm font-medium">User ID</div>
              <div className="text-xs text-muted-foreground font-mono-display mt-0.5">{user?.id ? user.id.slice(0,8) + "…" : "—"}</div>
            </div>
            <Pill tone="muted">Read only</Pill>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium">Plan</div>
              <div className="text-xs text-muted-foreground mt-0.5">Oracle Helix Pro — All sports, all agents</div>
            </div>
            <Pill tone="neon"><Zap className="size-2.5" /> Pro</Pill>
          </div>
        </div>
      </Panel>

      {/* Defaults */}
      <Panel>
        <PanelHeader title="Defaults" subtitle="Applied across all pages" icon={<Settings className="size-4" />} />
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Default Sport</label>
            <select value={prefs.defaultSport} onChange={e => set("defaultSport", e.target.value)}
              className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40">
              {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Default Unit Size</label>
            <input value={prefs.defaultUnits} onChange={e => set("defaultUnits", e.target.value)}
              type="number" min="0.1" step="0.1" placeholder="1"
              className="w-full bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40" />
            <p className="text-[10px] text-muted-foreground mt-1">Pre-fills the unit field when adding bets</p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Auto-Refresh Interval</label>
            <div className="flex gap-1.5 flex-wrap">
              {INTERVALS.map(iv => (
                <button key={iv.value} onClick={() => set("refreshInterval", iv.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition ${prefs.refreshInterval === iv.value ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
                  {iv.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Theme</label>
            <div className="flex gap-1.5">
              {([["system", <Monitor key="m" className="size-3" />, "System"], ["dark", <Moon key="d" className="size-3" />, "Dark"], ["light", <Sun key="l" className="size-3" />, "Light"]] as const).map(([val, icon, lbl]) => (
                <button key={val} onClick={() => set("theme", val)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition ${prefs.theme === val ? "bg-primary/15 text-primary border-primary/30" : "text-muted-foreground border-border hover:bg-muted/30"}`}>
                  {icon} {lbl}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Theme switching is visual preference only — full light mode coming soon.</p>
          </div>
        </div>
      </Panel>

      {/* Notifications */}
      <Panel>
        <PanelHeader title="Alert Preferences" icon={<Bell className="size-4" />} />
        <div className="space-y-3 mt-2">
          {([
            ["sharpSignals", "Sharp Money Signals", "Get notified when sharp-action thresholds are crossed"],
            ["injuries", "Injury Alerts", "Notify when key players are listed as Out or Doubtful"],
            ["evSpots", "+EV Opportunities", "Surface high-edge spots as they appear"],
          ] as const).map(([key, title, desc]) => (
            <div key={key} className="flex items-start justify-between gap-4 py-3 border-b border-border/40 last:border-0">
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
              </div>
              <button
                onClick={() => setPrefs(p => ({ ...p, notifications: { ...p.notifications, [key]: !p.notifications[key] } }))}
                className={`relative shrink-0 w-10 h-5 rounded-full transition-colors ${prefs.notifications[key] ? "bg-primary" : "bg-muted/60"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${prefs.notifications[key] ? "translate-x-5" : ""}`} />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">In-app alerts only — push notifications are on the roadmap.</p>
      </Panel>

      {/* API Health */}
      <Panel>
        <PanelHeader title="System Health" icon={<Database className="size-4" />} right={
          <button onClick={pingApi} disabled={pinging} className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border/30 rounded-lg px-3 py-1.5 hover:bg-muted/20 transition disabled:opacity-40">
            <RefreshCw className={`size-3 ${pinging ? "animate-spin" : ""}`} /> Ping
          </button>
        } />
        <div className="space-y-4 mt-2">
          <div className="flex items-center justify-between py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              {health.ok ? <Wifi className="size-4 text-emerald" /> : <WifiOff className="size-4 text-crimson" />}
              <div>
                <div className="text-sm font-medium">Oracle Helix API</div>
                <div className="text-xs text-muted-foreground font-mono-display">{API_BASE}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {health.latency !== null && (
                <span className="text-xs text-muted-foreground font-mono-display">{health.latency}ms</span>
              )}
              <Pill tone={health.ok ? "emerald" : "crimson"}>{health.label}</Pill>
            </div>
          </div>
          <ConfidenceMeter label="API Reliability" value={health.ok ? 98 : 0} />
          <div className="grid grid-cols-3 gap-3 mt-2">
            {[
              { label: "Backend", value: "Vercel Edge", tone: "neon" },
              { label: "Database", value: "Supabase", tone: "helix" },
              { label: "AI Engine", value: "8 Agents", tone: "emerald" },
            ].map(item => (
              <div key={item.label} className="glass rounded-xl p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
                <div className={`text-sm font-medium mt-1 ${item.tone === "neon" ? "text-primary" : item.tone === "helix" ? "text-accent" : "text-emerald"}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* Privacy / Security */}
      <Panel>
        <PanelHeader title="Privacy & Data" icon={<Shield className="size-4" />} />
        <div className="space-y-3 mt-2 text-sm">
          <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40">
            <div>
              <div className="font-medium">Bet Tracker Storage</div>
              <div className="text-xs text-muted-foreground mt-0.5">All bet data is stored in your browser's localStorage — it never leaves your device.</div>
            </div>
            <Pill tone="emerald"><Shield className="size-2.5" /> Local only</Pill>
          </div>
          <div className="flex items-start justify-between gap-4 py-3">
            <div>
              <div className="font-medium">Clear All Bet Data</div>
              <div className="text-xs text-muted-foreground mt-0.5">Permanently delete all tracked bets from this browser.</div>
            </div>
            <button onClick={() => { if (window.confirm("Delete all bet data? This cannot be undone.")) { localStorage.removeItem("oracle_helix_bets"); } }}
              className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-crimson/40 text-crimson hover:bg-crimson/10 transition">
              Clear Bets
            </button>
          </div>
        </div>
      </Panel>

      {/* Save */}
      <div className="flex items-center gap-3 pb-8">
        <button onClick={handleSave}
          className="flex items-center gap-2 bg-gradient-helix text-background text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition">
          {saved ? <><Check className="size-4" /> Saved!</> : <><Settings className="size-4" /> Save Preferences</>}
        </button>
        <button onClick={() => setPrefs(defaultPrefs())}
          className="text-sm text-muted-foreground px-4 py-2.5 rounded-xl border border-border/40 hover:bg-muted/20 transition">
          Reset Defaults
        </button>
      </div>
    </div>
  );
}
