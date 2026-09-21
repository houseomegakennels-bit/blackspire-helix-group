import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

async function readJson(target: string, fallback: Record<string, unknown>) {
  try { return JSON.parse(await readFile(target, "utf8")); }
  catch { return { ...fallback, status: "UNAVAILABLE" }; }
}

export async function GET() {
  const r1Path = process.env.HELIX_RESEARCH_STATUS_PATH || path.resolve(process.cwd(), "..", "helix-trade-command", "evidence", "latest-status.json");
  const v2Path = process.env.HELIX_V2_RESEARCH_STATUS_PATH || path.resolve(process.cwd(), "..", "helix-trade-command", "evidence", "v2", "latest-status.json");
  const r1 = await readJson(r1Path, { hypothesis: "R1-H1", validation_start: "2026-09-12", days_recorded: 0, events: 0, wins: 0, success_pct: null, wilson95: [null, null], gate_status: "PROVISIONAL", events_remaining: 30, live_trading: false });
  const v2 = await readJson(v2Path, { hypothesis: "LONDON-V2", validation_start: "2026-09-12", days_recorded: 0, trades: 0, wins: 0, expectancy_r: null, mean_r_lower95: null, profit_factor: null, net_pnl: 0, gate_status: "PROVISIONAL", trades_remaining: 30, live_trading: false });
  return Response.json({ r1, v2, live_trading: false, broker_execution_authorized: false }, { headers: { "cache-control": "no-store" } });
}
