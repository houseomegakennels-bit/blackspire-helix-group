import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  computeHelixLawnLeadEstimate,
  formatHelixLawnLeadStage,
  helixLawnPricingLogic,
  normalizeHelixLawnLeadInput,
  serviceLabels,
  type HelixLawnCommandSnapshot,
  type HelixLawnLeadInput,
  type HelixLawnLeadStage,
} from "@/lib/helix-lawn-command";

const HELIX_LAWN_BUCKET = "helix-lawn-command-leads";

export type StoredHelixLawnLead = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  phone: string;
  address: string;
  serviceType: string;
  serviceLabel: string;
  preferredDate: string | null;
  acreage: string | null;
  yardSize: string;
  grassHeight: string;
  overgrowth: string;
  bushes: number;
  frequency: string;
  cleanup: string;
  slope: string | null;
  access: string | null;
  notes: string | null;
  photoAnalysis: string | null;
  stage: HelixLawnLeadStage;
  stageLabel: string;
  urgency: "standard" | "medium" | "high";
  confidence: string;
  estimateLow: number;
  estimateHigh: number;
  summary: string;
  estimateBand: string;
  activity: Array<{ type: string; message: string; createdAt: string }>;
};

export type { HelixLawnCommandSnapshot } from "@/lib/helix-lawn-command";

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    throw new Error("Missing Supabase server credentials for Helix Lawn Command.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function ensureHelixLawnBucket(supabase: SupabaseClient) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(`Unable to list storage buckets: ${error.message}`);
  }

  if (buckets.some((bucket) => bucket.name === HELIX_LAWN_BUCKET)) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(HELIX_LAWN_BUCKET, {
    public: false,
    fileSizeLimit: "2MB",
    allowedMimeTypes: ["application/json"],
  });

  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    throw new Error(`Unable to create Helix Lawn bucket: ${createError.message}`);
  }
}

function buildLeadActivity(record: {
  createdAt: string;
  stage: HelixLawnLeadStage;
  urgency: string;
  estimateBand: string;
  frequency: string;
}) {
  const activity = [
    {
      type: "lead_captured",
      message: "New lead captured from website form.",
      createdAt: record.createdAt,
    },
    {
      type: "ai_qualified",
      message: `AI assistant rated lead ${record.urgency.toUpperCase()} and set stage ${formatHelixLawnLeadStage(record.stage)}.`,
      createdAt: record.createdAt,
    },
    {
      type: "estimate_generated",
      message: `Preliminary estimate ${record.estimateBand} generated.`,
      createdAt: record.createdAt,
    },
  ];

  if (record.frequency === "weekly" || record.frequency === "biweekly") {
    activity.push({
      type: "recurring_signal",
      message: "Recurring service signal detected. Follow-up should emphasize route-fit and cadence.",
      createdAt: record.createdAt,
    });
  }

  return activity;
}

function serializeLeadPayload(input: HelixLawnLeadInput): StoredHelixLawnLead {
  const normalized = normalizeHelixLawnLeadInput(input);
  const estimate = computeHelixLawnLeadEstimate(normalized);
  const createdAt = new Date().toISOString();
  const estimateBand = `$${estimate.low} - $${estimate.high}`;

  return {
    id: crypto.randomUUID(),
    createdAt,
    updatedAt: createdAt,
    name: normalized.name,
    phone: normalized.phone,
    address: normalized.address,
    serviceType: normalized.serviceType,
    serviceLabel: serviceLabels[normalized.serviceType] ?? "Lawn service",
    preferredDate: normalized.preferredDate || null,
    acreage: normalized.acreage || null,
    yardSize: normalized.yardSize,
    grassHeight: normalized.grassHeight,
    overgrowth: normalized.overgrowth,
    bushes: Number(normalized.bushes || 0),
    frequency: normalized.frequency,
    cleanup: normalized.cleanup,
    slope: normalized.slope || null,
    access: normalized.access || null,
    notes: normalized.notes || null,
    photoAnalysis: normalized.photoAnalysis || null,
    stage: estimate.stage,
    stageLabel: formatHelixLawnLeadStage(estimate.stage),
    urgency: estimate.urgency,
    confidence: estimate.confidence,
    estimateLow: estimate.low,
    estimateHigh: estimate.high,
    summary: estimate.summary,
    estimateBand,
    activity: buildLeadActivity({
      createdAt,
      stage: estimate.stage,
      urgency: estimate.urgency,
      estimateBand,
      frequency: normalized.frequency,
    }),
  };
}

function getStoragePath(id: string) {
  return `${id}.json`;
}

function validateRequiredLeadFields(input: HelixLawnLeadInput) {
  if (!input.name || !input.phone || !input.address) {
    throw new Error("Name, phone, and address are required.");
  }
}

async function downloadLeadObject(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage.from(HELIX_LAWN_BUCKET).download(path);
  if (error) {
    throw new Error(`Unable to download lawn lead ${path}: ${error.message}`);
  }

  const text = await data.text();
  return JSON.parse(text) as StoredHelixLawnLead;
}

export async function createHelixLawnLead(input: Partial<HelixLawnLeadInput>) {
  const supabase = getSupabaseAdmin();
  await ensureHelixLawnBucket(supabase);

  const normalized = normalizeHelixLawnLeadInput(input);
  validateRequiredLeadFields(normalized);

  const payload = serializeLeadPayload(normalized);
  const body = JSON.stringify(payload, null, 2);

  const { error } = await supabase.storage
    .from(HELIX_LAWN_BUCKET)
    .upload(getStoragePath(payload.id), body, {
      contentType: "application/json",
      upsert: false,
    });

  if (error) {
    throw new Error(`Unable to store lawn lead: ${error.message}`);
  }

  return payload;
}

export async function listHelixLawnLeads(limit = 24) {
  const supabase = getSupabaseAdmin();
  await ensureHelixLawnBucket(supabase);

  const { data: objects, error } = await supabase.storage.from(HELIX_LAWN_BUCKET).list("", {
    limit,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    throw new Error(`Unable to list lawn leads: ${error.message}`);
  }

  const files = (objects ?? []).filter((item) => item.name.endsWith(".json"));
  const leads = await Promise.all(files.map((file) => downloadLeadObject(supabase, file.name)));

  return leads.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

const stageOrder: HelixLawnLeadStage[] = [
  "new_lead",
  "estimate_needed",
  "quote_sent",
  "booked",
  "completed",
  "lost",
];

export { helixLawnPricingLogic } from "@/lib/helix-lawn-command";

export async function getHelixLawnCommandSnapshot(): Promise<HelixLawnCommandSnapshot> {
  const leads = await listHelixLawnLeads(48);
  const stageCounts = new Map<HelixLawnLeadStage, number>(
    stageOrder.map((stage) => [stage, 0]),
  );

  for (const lead of leads) {
    stageCounts.set(lead.stage, (stageCounts.get(lead.stage) ?? 0) + 1);
  }

  const metricCards = [
    {
      value: String(leads.length),
      label: "New Leads",
      detail: leads.length ? "captured in this live feed" : "waiting for the first lead",
    },
    {
      value: String(stageCounts.get("estimate_needed") ?? 0),
      label: "Estimate Needed",
      detail: "manual review required",
    },
    {
      value: String(stageCounts.get("quote_sent") ?? 0),
      label: "Quote Sent",
      detail: "ready for follow-up",
    },
    {
      value: String(stageCounts.get("booked") ?? 0),
      label: "Booked Jobs",
      detail: "confirmed route slots",
    },
    {
      value: String(stageCounts.get("completed") ?? 0),
      label: "Completed Jobs",
      detail: "closed and serviced",
    },
    {
      value: String(
        leads.filter(
          (lead) => lead.stage === "new_lead" || lead.stage === "estimate_needed",
        ).length,
      ),
      label: "Follow-Ups Due",
      detail: "operator attention needed",
    },
  ];

  const pipelineColumns = stageOrder.map((stage) => {
    const stageLeads = leads.filter((lead) => lead.stage === stage).slice(0, 6);
    return {
      label: formatHelixLawnLeadStage(stage),
      count: stageCounts.get(stage) ?? 0,
      items: stageLeads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        service: lead.serviceLabel,
        estimate: lead.estimateBand,
        urgency: lead.urgency,
      })),
    };
  });

  const recentLeads = leads.slice(0, 6).map((lead) => ({
    id: lead.id,
    name: lead.name,
    service: lead.serviceLabel,
    address: lead.address,
    urgency: lead.urgency,
    estimate: lead.estimateBand,
    stage: lead.stageLabel,
    phone: lead.phone,
    preferredDate: lead.preferredDate,
    summary: lead.summary,
    confidence: lead.confidence,
    createdAt: lead.createdAt,
  }));

  const estimateQueue = leads
    .filter((lead) => lead.stage === "estimate_needed")
    .slice(0, 8)
    .map((lead) => ({
      id: lead.id,
      name: lead.name,
      service: lead.serviceLabel,
      address: lead.address,
      estimate: lead.estimateBand,
      reason:
        lead.cleanup === "heavy" || lead.overgrowth === "heavy" || lead.yardSize === "acreage"
          ? "Owner review required because the job has heavy, acreage, or complex conditions."
          : "Owner review recommended before sending the quote.",
    }));

  const followUps = leads
    .filter((lead) => lead.stage === "new_lead" || lead.stage === "quote_sent" || lead.stage === "estimate_needed")
    .slice(0, 8)
    .map((lead) => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      service: lead.serviceLabel,
      estimate: lead.estimateBand,
      nextStep:
        lead.stage === "estimate_needed"
          ? "Review property details, then call or text with a confirmed range."
          : lead.stage === "quote_sent"
            ? "Follow up with schedule options and ask for booking confirmation."
            : "Send the first estimate response and confirm timing.",
    }));

  const outreachDrafts = leads.slice(0, 6).map((lead) => ({
    id: lead.id,
    name: lead.name,
    channel: "SMS",
    subject: `${lead.serviceLabel} estimate follow-up`,
    body: `Hi ${lead.name}, this is Helix Lawn Command. Based on your ${lead.serviceLabel.toLowerCase()} request at ${lead.address}, the preliminary range is ${lead.estimateBand}. Want us to confirm details and get you on the schedule?`,
  }));

  const importHistory = leads.slice(0, 8).map((lead) => ({
    id: lead.id,
    source: "Website intake",
    status: lead.stageLabel,
    detail: `${lead.name} submitted ${lead.serviceLabel.toLowerCase()} and entered ${lead.stageLabel}.`,
    createdAt: lead.createdAt,
  }));

  const priorityActions = leads.slice(0, 4).map((lead) => {
    if (lead.stage === "estimate_needed") {
      return `Owner review needed for ${lead.name} — ${lead.serviceLabel} at ${lead.address} is outside auto-estimate comfort.`;
    }
    if (lead.frequency === "weekly" || lead.frequency === "biweekly") {
      return `Route-fit follow-up for ${lead.name} — recurring ${lead.serviceLabel.toLowerCase()} lead should get schedule options fast.`;
    }
    return `Send estimate and confirm timing with ${lead.name} — ${lead.estimateBand} for ${lead.serviceLabel.toLowerCase()}.`;
  });

  if (!priorityActions.length) {
    priorityActions.push(
      "No live leads yet — use the intake demo on the offer page to seed the command center.",
    );
  }

  const activityItems = leads
    .flatMap((lead) =>
      lead.activity.map((item) => ({
        createdAt: item.createdAt,
        message: `${lead.name}: ${item.message}`,
        meta: `${new Date(item.createdAt).toLocaleString("en-US")} · ${item.type}`,
      })),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8)
    .map(({ message, meta }) => ({ message, meta }));

  if (!activityItems.length) {
    activityItems.push({
      message: "Waiting for the first lawn lead to hit the live pipeline.",
      meta: "Helix Lawn Command · standby",
    });
  }

  return {
    metricCards,
    pipelineColumns,
    recentLeads,
    estimateQueue,
    followUps,
    outreachDrafts,
    importHistory,
    priorityActions,
    activityItems,
    totalLeadCount: leads.length,
  };
}
