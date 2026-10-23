import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdminPage } from "@/lib/operator-access";
import { buildPropertyWorkboard, type PropertyWorkboard, type WorkboardLog, type WorkboardProperty, type WorkboardDeadline } from "@/lib/property-workboard-model";

const message = "Today and property search could not be evaluated. Refresh to retry; unavailable data does not mean there are no tasks or properties.";
function unavailable(today: string): PropertyWorkboard { return { available: false, reason: message, properties: [], items: [], today }; }

// Admins already have this complete workspace in /workspace. No new grants or bypasses.
export async function getPropertyWorkboard(): Promise<PropertyWorkboard> {
  await requireAdminPage();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return unavailable(today);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return readPropertyWorkboard(client, today);
}

// Bounded complete reads: a cap/refused/later failed page is unavailable, never a partial queue.
// No fallback samples, cache, guessed deadlines or provider calls.
export async function readPropertyWorkboard(client: SupabaseClient, today: string): Promise<PropertyWorkboard> {
  try {
    const count = await client.from("deal_leads").select("id", { count: "exact", head: true });
    if (count.error || count.count == null || count.count < 0 || count.count > 5000) return unavailable(today);
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0, reads = 0; offset < count.count && reads < 10; reads += 1) {
      const response = await client.from("deal_leads")
        .select("id,property_address,owner_name,county,status,recommended_next_action")
        .order("id", { ascending: true }).range(offset, Math.min(offset + 999, count.count - 1));
      if (response.error || !response.data?.length) return unavailable(today);
      rows.push(...response.data);
      offset += response.data.length;
    }
    const properties: WorkboardProperty[] = rows.map(row => ({
      id: String(row.id), address: String(row.property_address ?? "Address not recorded"), ownerName: String(row.owner_name ?? "Owner not recorded"),
      county: String(row.county ?? "Unknown"), status: String(row.status ?? "Imported"), nextAction: String(row.recommended_next_action ?? "")
    }));
    if (properties.length !== count.count || new Set(properties.map(property => property.id)).size !== count.count) return unavailable(today);
    const logs: WorkboardLog[] = [];
    const deadlines: WorkboardDeadline[] = [];
    let deadlineRows = 0;
    for (let start = 0; start < properties.length; start += 100) {
      const ids = properties.slice(start, start + 100).map(property => property.id);
      const query = (head: boolean) => client.from("disposition_logs")
        .select(head ? "id" : "id,lead_id,action_type,payload,created_at", head ? { count: "exact", head: true } : {})
        .in("lead_id", ids).in("action_type", ["operator_task", "coordination_update"]);
      const logCount = await query(true);
      if (logCount.error || logCount.count == null || logs.length + logCount.count > 20000) return unavailable(today);
      let loaded = 0;
      const batch: WorkboardLog[] = [];
      for (let reads = 0; loaded < logCount.count && reads < 25; reads += 1) {
        const page = await query(false).order("id", { ascending: true }).range(loaded, Math.min(loaded + 999, logCount.count - 1));
        if (page.error || !page.data?.length) return unavailable(today);
        batch.push(...page.data as unknown as WorkboardLog[]);
        loaded += page.data.length;
      }
      if (loaded !== logCount.count || new Set(batch.map(log => log.id)).size !== loaded || batch.some(log => !ids.includes(log.lead_id))) return unavailable(today);
      logs.push(...batch);
      const sources = [
        { table: "deal_title_checklist_items", fields: "id,deal_id,label,status,notes,due_date,assigned_owner", order: "id", source: "Title checklist" },
        { table: "deal_closing_timeline_events", fields: "id,deal_id,event_type,label,status,due_date,completed_at,notes", order: "id", source: "Closing timeline" },
        { table: "deal_emd_trackers", fields: "deal_id,emd_due_date,emd_holder,emd_status,emd_notes", order: "deal_id", source: "Deposit tracker" },
        { table: "deal_assignment_fee_trackers", fields: "deal_id,payout_due_date,payout_status,payout_notes", order: "deal_id", source: "Payout tracker" },
      ];
      for (const source of sources) {
        const query = (head: boolean) => client.from(source.table)
          .select(head ? "deal_id" : source.fields, head ? { count: "exact", head: true } : {}).in("deal_id", ids);
        const counted = await query(true);
        if (counted.error || counted.count == null || deadlineRows + counted.count > 20000) return unavailable(today);
        const entries: Array<Record<string, unknown>> = [];
        for (let reads = 0; entries.length < counted.count && reads < 25; reads += 1) {
          const page = await query(false).order(source.order, { ascending: true }).range(entries.length, Math.min(entries.length + 999, counted.count - 1));
          if (page.error || !page.data?.length) return unavailable(today);
          entries.push(...page.data as unknown as Array<Record<string, unknown>>);
        }
        if (entries.length !== counted.count || new Set(entries.map(row => row[source.order])).size !== entries.length || entries.some(row => !ids.includes(String(row.deal_id)))) return unavailable(today);
        deadlineRows += entries.length;
        const str = (value: unknown) => typeof value === "string" ? value : null;
        for (const row of entries) deadlines.push({
          id: String(row[source.order]), dealId: String(row.deal_id), source: source.source,
          title: str(row.label) || (source.source === "Deposit tracker" ? "Review purchase deposit deadline" : source.source === "Payout tracker" ? "Review payout deadline" : "Review saved closing item"),
          owner: str(row.assigned_owner), dueAt: str(row.due_date ?? row.emd_due_date ?? row.payout_due_date),
          status: str(row.status ?? row.emd_status ?? row.payout_status), notes: str(row.notes ?? row.emd_notes ?? row.payout_notes), completedAt: str(row.completed_at),
        });
      }
    }
    return buildPropertyWorkboard(properties, logs, today, deadlines);
  } catch {
    return unavailable(today);
  }
}
