import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle, Panel, Pill } from "@/components/oracle/Primitives";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { ShieldCheck, RefreshCw, CheckCircle, XCircle } from "lucide-react";

export const Route = createFileRoute("/_app/admin")({ component: AdminPage });

const CRON_SECRET = import.meta.env.VITE_CRON_SECRET ?? "";
const ENDPOINTS = ["sync-scores","sync-odds","sync-teams-players","sync-injuries","generate-signals","generate-research-cards"];

function AdminPage() {
  const [results, setResults] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});

  async function runCron(name: string) {
    setRunning(r => ({ ...r, [name]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/cron/${name}`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
      const json = await res.json();
      setResults(r => ({ ...r, [name]: res.ok ? "✅ " + JSON.stringify(json.results ?? json.message ?? "ok") : "❌ " + json.error }));
    } catch (e) { setResults(r => ({ ...r, [name]: "❌ " + (e as Error).message })); }
    finally { setRunning(r => ({ ...r, [name]: false })); }
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Admin" title="Cron Control Panel" description="Manually trigger data sync jobs." right={<Pill tone="crimson"><ShieldCheck className="size-3" /> Admin</Pill>} />
      <div className="grid md:grid-cols-2 gap-3">
        {ENDPOINTS.map(ep => (
          <Panel key={ep} className="!p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono-display text-xs text-primary">/api/cron/{ep}</div>
              <button onClick={() => runCron(ep)} disabled={running[ep]} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50 transition">
                <RefreshCw className={`size-3 ${running[ep] ? "animate-spin" : ""}`} />
                {running[ep] ? "Running…" : "Run"}
              </button>
            </div>
            {results[ep] && <div className="text-[11px] text-muted-foreground mt-2 font-mono-display break-all">{results[ep]}</div>}
          </Panel>
        ))}
      </div>
    </div>
  );
}
