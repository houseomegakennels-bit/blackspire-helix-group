export type HelixLawnLeadInput = {
  name: string;
  phone: string;
  address: string;
  serviceType: string;
  preferredDate: string;
  acreage: string;
  yardSize: string;
  grassHeight: string;
  overgrowth: string;
  bushes: string;
  frequency: string;
  cleanup: string;
  slope: string;
  access: string;
  notes: string;
  photoAnalysis: string;
};

export type HelixLawnLeadStage =
  | "new_lead"
  | "estimate_needed"
  | "quote_sent"
  | "booked"
  | "completed"
  | "lost";

export type HelixLawnLeadEstimate = {
  low: number;
  high: number;
  urgency: "standard" | "medium" | "high";
  confidence: string;
  summary: string;
  stage: HelixLawnLeadStage;
};

export type HelixLawnCommandSnapshot = {
  metricCards: Array<{ value: string; label: string; detail: string }>;
  pipelineColumns: Array<{
    label: string;
    count: number;
    items: Array<{
      id: string;
      name: string;
      service: string;
      estimate: string;
      urgency: string;
    }>;
  }>;
  recentLeads: Array<{
    id: string;
    name: string;
    service: string;
    address: string;
    urgency: string;
    estimate: string;
    stage: string;
    phone: string;
    preferredDate: string | null;
    summary: string;
    confidence: string;
    createdAt: string;
  }>;
  estimateQueue: Array<{
    id: string;
    name: string;
    service: string;
    address: string;
    estimate: string;
    reason: string;
  }>;
  followUps: Array<{
    id: string;
    name: string;
    phone: string;
    service: string;
    estimate: string;
    nextStep: string;
  }>;
  outreachDrafts: Array<{
    id: string;
    name: string;
    channel: string;
    subject: string;
    body: string;
  }>;
  importHistory: Array<{
    id: string;
    source: string;
    status: string;
    detail: string;
    createdAt: string;
  }>;
  priorityActions: string[];
  activityItems: Array<{ message: string; meta: string }>;
  totalLeadCount: number;
};

export const initialHelixLawnLeadInput: HelixLawnLeadInput = {
  name: "",
  phone: "",
  address: "",
  serviceType: "mowing",
  preferredDate: "",
  acreage: "",
  yardSize: "medium",
  grassHeight: "standard",
  overgrowth: "light",
  bushes: "0",
  frequency: "one-time",
  cleanup: "none",
  slope: "",
  access: "",
  notes: "",
  photoAnalysis: "",
};

export const serviceLabels: Record<string, string> = {
  mowing: "Lawn mowing",
  mulch: "Mulch install",
  cleanup: "Yard cleanup",
  trimming: "Bush trimming",
};

export const helixLawnPricingLogic = [
  "Small city yard mowing: $45-$75",
  "Medium residential yard: $75-$125",
  "Large residential yard: $125-$225",
  "Acreage mowing: usually $75-$150+ per acre depending on terrain and overgrowth",
  "5+ acres: trigger manual review, do not estimate under $300",
  "10 acres: flag as high-value acreage/commercial job, broadly $750-$1,500+",
  "Overgrowth: can add 25%-100%",
  "Bush trimming: $10-$25 per bush light, $25-$60 per bush heavy",
  "Cleanup / debris / leaves: $150-$600+",
  "Slope, tight access, pets, gates, debris, hauling: increase price or trigger owner review",
  "Recurring service: can reduce per-visit price vs one-time",
] as const;

const yardBase: Record<string, number> = {
  small: 65,
  medium: 105,
  large: 165,
  acreage: 230,
};

const grassAdjust: Record<string, number> = {
  short: 0,
  standard: 14,
  tall: 32,
};

const overgrowthAdjust: Record<string, number> = {
  light: 0,
  moderate: 24,
  heavy: 58,
};

const cleanupAdjust: Record<string, number> = {
  none: 0,
  light: 30,
  heavy: 70,
};

const frequencyAdjust: Record<string, number> = {
  "one-time": 1,
  weekly: 0.84,
  biweekly: 0.92,
};

export function normalizeHelixLawnLeadInput(
  input: Partial<HelixLawnLeadInput> | null | undefined,
): HelixLawnLeadInput {
  return {
    name: input?.name?.trim() ?? "",
    phone: input?.phone?.trim() ?? "",
    address: input?.address?.trim() ?? "",
    serviceType: input?.serviceType?.trim() || initialHelixLawnLeadInput.serviceType,
    preferredDate: input?.preferredDate?.trim() ?? "",
    acreage: input?.acreage?.trim() ?? "",
    yardSize: input?.yardSize?.trim() || initialHelixLawnLeadInput.yardSize,
    grassHeight: input?.grassHeight?.trim() || initialHelixLawnLeadInput.grassHeight,
    overgrowth: input?.overgrowth?.trim() || initialHelixLawnLeadInput.overgrowth,
    bushes: input?.bushes?.trim() || initialHelixLawnLeadInput.bushes,
    frequency: input?.frequency?.trim() || initialHelixLawnLeadInput.frequency,
    cleanup: input?.cleanup?.trim() || initialHelixLawnLeadInput.cleanup,
    slope: input?.slope?.trim() ?? "",
    access: input?.access?.trim() ?? "",
    notes: input?.notes?.trim() ?? "",
    photoAnalysis: input?.photoAnalysis?.trim() ?? "",
  };
}

function parseAcreage(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeHelixLawnLeadEstimate(form: HelixLawnLeadInput): HelixLawnLeadEstimate {
  const base = yardBase[form.yardSize] ?? 105;
  const bushes = Number(form.bushes || 0) * 9;
  const subtotal =
    base +
    (grassAdjust[form.grassHeight] ?? 14) +
    (overgrowthAdjust[form.overgrowth] ?? 0) +
    (cleanupAdjust[form.cleanup] ?? 0) +
    bushes;
  const multiplier = frequencyAdjust[form.frequency] ?? 1;
  const adjusted = Math.round(subtotal * multiplier);
  const low = Math.max(45, Math.round(adjusted * 0.9));
  const high = Math.round(adjusted * 1.14);
  const urgency =
    form.overgrowth === "heavy" ? "high" : form.cleanup === "heavy" ? "medium" : "standard";
  const confidence =
    form.photoAnalysis || form.notes || form.acreage
      ? "higher confidence"
      : "owner review recommended";
  const summary = `${serviceLabels[form.serviceType] ?? "Lawn service"} lead for ${
    form.address || "local property"
  } with ${form.yardSize} yard, ${form.grassHeight} grass, and ${form.overgrowth} overgrowth.`;

  const acreage = parseAcreage(form.acreage);
  const requiresManualReview =
    (acreage !== null && acreage >= 5) ||
    form.overgrowth === "heavy" ||
    form.cleanup === "heavy" ||
    form.yardSize === "acreage";
  const stage: HelixLawnLeadStage = requiresManualReview
    ? "estimate_needed"
    : form.frequency === "weekly" || form.frequency === "biweekly"
      ? "quote_sent"
      : "new_lead";

  return {
    low,
    high,
    urgency,
    confidence,
    summary,
    stage,
  };
}

export function formatHelixLawnLeadStage(stage: HelixLawnLeadStage) {
  switch (stage) {
    case "new_lead":
      return "New Lead";
    case "estimate_needed":
      return "Estimate Needed";
    case "quote_sent":
      return "Quote Sent";
    case "booked":
      return "Booked";
    case "completed":
      return "Completed";
    case "lost":
      return "Lost";
    default:
      return stage;
  }
}
