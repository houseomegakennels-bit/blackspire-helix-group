import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = process.env.HELIX_RESEARCH_STATUS_PATH;
  const fallback = path.resolve(process.cwd(), "..", "helix-trade-command", "evidence", "latest-status.json");
  const target = configured || fallback;
  try {
    const raw = await readFile(target, "utf8");
    return new Response(raw, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({
      hypothesis: "R1-H1",
      validation_start: "2026-09-12",
      days_recorded: 0,
      events: 0,
      wins: 0,
      success_pct: null,
      wilson95: [null, null],
      gate_status: "PROVISIONAL",
      events_remaining: 30,
      live_trading: false,
      status: "UNAVAILABLE",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
