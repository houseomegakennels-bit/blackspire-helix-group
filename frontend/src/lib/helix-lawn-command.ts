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
