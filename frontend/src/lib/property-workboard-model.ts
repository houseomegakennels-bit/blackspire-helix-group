export type WorkboardProperty = {
  id: string;
  address: string;
  ownerName: string;
  county: string;
  status: string;
  nextAction: string;
};
export type WorkboardLog = { id: string; lead_id: string; action_type: string; created_at: string; payload: Record<string, unknown> | null };
export type TodayItem = {
  id: string; dealId: string; address: string; title: string; owner: string; dueAt: string | null;
  dueOn: string | null; dateIssue: boolean; status: string; blocker: string | null; priority: string;
  href: string; source: string; urgency: "overdue" | "today" | "upcoming" | "unscheduled";
};
export type WorkboardDeadline = { id: string; dealId: string; title: string; source: string; owner?: string | null; dueAt?: string | null; status?: string | null; notes?: string | null; completedAt?: string | null };
export type PropertyWorkboard = { available: boolean; reason: string | null; properties: WorkboardProperty[]; items: TodayItem[]; today: string };
const text = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const complete = (status: string) => /^(done|completed?|closed|cancelled|canceled|resolved|paid|received|reviewed|final)$/i.test(status.trim());
export function workboardDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return null;
  const date = value.slice(0, 10);
  const parsed = new Date(date + "T12:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  if (value.length === 10) return date;
  if (Number.isNaN(Date.parse(value))) return null;
  // Date-only and local datetime fields retain the date explicitly saved by the operator.
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? new Date(value).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : date;
}
export function buildPropertyWorkboard(properties: WorkboardProperty[], logs: WorkboardLog[], today: string, deadlines: WorkboardDeadline[] = []): PropertyWorkboard {
  const propertyById = new Map(properties.map(property => [property.id, property]));
  const latestTasks = new Set<string>();
  const latestCoordination = new Set<string>();
  const items: TodayItem[] = [];
  function add(property: WorkboardProperty, input: { id: string; title: string; owner?: unknown; dueAt?: unknown; status?: unknown; notes?: unknown; priority?: unknown; section?: string; source?: string }) {
    const status = text(input.status) || "Open";
    if (complete(status) || input.source === "Deposit tracker" && /^(not_required|released|forfeited)$/i.test(status)) return;
    const dueAt = text(input.dueAt) || null;
    const dueOn = dueAt ? workboardDate(dueAt) : null;
    const waiting = /^(waiting|awaiting|blocked|on hold|pending(?: closing)?|delayed|submitted|not received)(?:\b|$)/i.test(status.replaceAll("_", " "));
    items.push({ id: input.id, dealId: property.id, address: property.address, title: input.title,
      owner: text(input.owner) || "Unassigned", dueAt, dueOn, dateIssue: Boolean(dueAt && !dueOn), status,
      blocker: waiting ? text(input.notes) || "Waiting reason has not been recorded." : null,
      priority: text(input.priority, "Normal"), source: input.source ?? "Saved task", href: `/workspace/deal-engine/${encodeURIComponent(property.id)}#${input.section ?? "property-closing"}`,
      urgency: !dueOn ? "unscheduled" : dueOn < today ? "overdue" : dueOn === today ? "today" : "upcoming" });
  }
  const sorted = [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  for (const log of sorted) {
    const property = propertyById.get(log.lead_id);
    if (!property || /^(closed|dead|lost|archived|completed)(?:\b|$)/i.test(property.status)) continue;
    const payload = record(log.payload);
    if (log.action_type === "operator_task") {
      const taskId = text(payload.taskId) || log.id;
      const key = property.id + ":" + taskId;
      if (latestTasks.has(key)) continue;
      latestTasks.add(key);
      add(property, { id: key, title: text(payload.title) || "Review saved task", owner: payload.owner, dueAt: payload.dueDate, status: payload.status, notes: payload.notes, priority: payload.priority, section: "property-activity" });
    }
    if (log.action_type === "coordination_update" && !latestCoordination.has(property.id)) {
      latestCoordination.add(property.id);
      for (const [key, title] of [["inspectionEndsOn", "Review inspection deadline"], ["closingDate", "Review closing deadline"], ["walkthroughAt", "Review scheduled walkthrough"]]) {
        if (text(payload[key])) add(property, { id: property.id + ":" + key, title, dueAt: payload[key], status: "Scheduled", priority: "High", source: "Closing coordination" });
      }
      for (const raw of Array.isArray(payload.closingChecklist) ? payload.closingChecklist : []) {
        const item = record(raw);
        add(property, { id: property.id + ":checklist:" + (text(item.id) || text(item.title)), title: text(item.title) || "Review closing checklist item", owner: item.owner, dueAt: item.dueDate, status: item.status, notes: item.notes, source: "Closing coordination" });
      }
    }
  }
  for (const deadline of deadlines) {
    const property = propertyById.get(deadline.dealId);
    if (!property || /^(closed|dead|lost|archived|completed)(?:\b|$)/i.test(property.status) || deadline.completedAt && workboardDate(deadline.completedAt)) continue;
    add(property, { ...deadline, id: property.id + ":" + deadline.source + ":" + deadline.id });
  }
  const scheduledProperties = new Set(items.map(item => item.dealId));
  for (const property of properties) {
    if (scheduledProperties.has(property.id) || /^(closed|dead|lost|archived|completed)(?:\b|$)/i.test(property.status)) continue;
    add(property, { id: property.id + ":next", title: property.nextAction || "Review this property and choose a next step", owner: "Unassigned", status: "Needs review", section: "property-research", source: "Saved property next step" });
  }
  const rank = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3 };
  items.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || Number(Boolean(b.blocker)) - Number(Boolean(a.blocker)) || a.dealId.localeCompare(b.dealId) || a.id.localeCompare(b.id));
  return { available: true, reason: null, properties, items, today };
}
export function filterWorkboardProperties(properties: WorkboardProperty[], filters: { query: string; stage: string; county: string }) {
  const query = filters.query.trim().toLowerCase();
  return properties.filter(property => (!query || [property.id, property.address, property.ownerName, property.county].join(" ").toLowerCase().includes(query))
    && (!filters.stage || property.status === filters.stage) && (!filters.county || property.county === filters.county));
}
