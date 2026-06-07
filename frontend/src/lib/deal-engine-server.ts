import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  dealEngineBuyerSignals as fallbackBuyerSignals,
  dealEngineContractDrafts as fallbackContractDrafts,
  dealEngineLeads as fallbackLeads,
  dealEngineMetrics as fallbackMetrics,
  dealEngineSellerSignals as fallbackSellerSignals,
  type DealEngineBuyerSignal,
  type DealEngineContractDraft,
  type DealEngineLead,
  type DealEngineSellerSignal,
} from "@/lib/deal-engine";
import type { SellerLeadView } from "@/lib/seller-engine-demo";
import { DEMO_SELLER_LEADS } from "@/lib/seller-engine-demo";
import { listSellerLeads, updateSellerLead } from "@/lib/seller-engine-server";
import {
  listAllBuyerReports,
  listOutreachDraftRecords,
  persistOutreachDraftRecord,
  listSearchJobsByIds,
  type BuyerReportRecord,
  type SearchJobRecord,
} from "@/lib/buyer-engine-server";

type EnvState = {
  enabled: boolean;
  missing: string[];
};

type DealLeadJoin = {
  id: string;
  owner_name: string | null;
  property_address: string | null;
  county: string | null;
  status: string | null;
  motivation_score: number | null;
  recommended_next_action: string | null;
  deal_analysis:
    | {
        maximum_allowable_offer: number | string | null;
        assignment_fee_target: number | string | null;
      }
    | Array<{
        maximum_allowable_offer: number | string | null;
        assignment_fee_target: number | string | null;
      }>
    | null;
  seller_conversations:
    | {
        next_action: string | null;
      }
    | Array<{
        next_action: string | null;
      }>
    | null;
  buyer_matches:
    | {
        exit_strategy: string | null;
      }
    | Array<{
        exit_strategy: string | null;
      }>
    | null;
};

type NexusContactRow = {
  owner_name: string;
  property_address: string;
  mailing_address: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  contact_confidence_score: number | null;
  provider: string | null;
  status: string | null;
  updated_at: string;
};

export type DealEngineMetric = {
  label: string;
  value: string;
  detail: string;
};

export type DealEngineWorkspaceSnapshot = {
  env: EnvState;
  usingFallback: boolean;
  leads: DealEngineLead[];
  metrics: DealEngineMetric[];
  heroSignals: string[];
  stageBoard: Array<{
    label: string;
    count: number;
    detail: string;
    deals: DealEngineLead[];
  }>;
  sellerSignals: DealEngineSellerSignal[];
  buyerSignals: DealEngineBuyerSignal[];
  contractDrafts: DealEngineContractDraft[];
};

export type DealEngineDealDetail = {
  lead: DealEngineLead;
  sellerSignal: DealEngineSellerSignal | null;
  sellerContact: {
    ownerName: string;
    ownerPhone: string;
    phoneStatus: string;
    skipTraceStatus: string;
    phoneSource: string;
    contactEnrichmentNotes: string;
  };
  sellerContactWorkflow: Array<{
    id: string;
    title: string;
    detail: string;
    status: "ready" | "active" | "blocked";
  }>;
  sellerOutreach: {
    firstTouchSms: string;
    followUpSms: string;
    emailSubject: string;
    emailBody: string;
    objectionReply: string;
    voicemailScript: string;
    callOpener: string;
  };
  buyerSignals: DealEngineBuyerSignal[];
  contractDraft: DealEngineContractDraft | null;
  coordination: {
    titleCompany: string;
    titleOfficer: string;
    walkthroughAt: string;
    inspectionEndsOn: string;
    closingDate: string;
    buyerAssignmentStatus: string;
    earnestMoneyStatus: string;
    payoutStatus: string;
    contractSent: boolean;
    contractSigned: boolean;
    coordinationNotes: string;
    closingChecklist: Array<{
      id: string;
      title: string;
      status: string;
      owner: string;
      dueDate: string;
    }>;
    closingDocuments: Array<{
      id: string;
      name: string;
      status: string;
      owner: string;
      notes: string;
    }>;
  };
  room: {
    slug: string;
    propertySummary: string;
    financialBreakdown: string[];
    mapPlaceholder: string;
    compsPlaceholder: string[];
    downloadablePdfLabel: string;
    submitInterestLabel: string;
    requestWalkthroughLabel: string;
  };
  packet: {
    propertyNotes: string;
    investorSummary: string;
    buyerEmailBlast: string;
    buyerSmsAlert: string;
    contactInstructions: string;
    deadlineToSubmitOffer: string;
    comps: string[];
  };
  sellerDrafts: Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    createdAt: string;
  }>;
  relatedDrafts: Array<{
    id: string;
    buyerName: string;
    subject: string;
    angle: string;
    body: string;
    createdAt: string;
  }>;
  investorResponses: Array<{
    id: string;
    investorName: string;
    investorEmail: string;
    interestType: string;
    notes: string;
    preferredWalkthroughAt: string;
    attendeeCount: string;
    proofOfFundsStatus: string;
    submittedAt: string;
    followUpStatus: string;
    followUpOwner: string;
    nextStep: string;
    lastUpdatedAt: string;
  }>;
  operatorTasks: Array<{
    id: string;
    title: string;
    owner: string;
    dueDate: string;
    priority: string;
    status: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
  }>;
  activityFeed: Array<{
    id: string;
    title: string;
    detail: string;
    timestamp: string;
    tone: "neutral" | "good" | "warn" | "active";
  }>;
};

type BuyerReportView = {
  id: string;
  searchJobId: string;
  county: string | null;
  state: string | null;
  propertyType: string | null;
  buyerName: string;
  mailingAddress: string;
  score: number;
  purchaseCount: number;
  totalSpend: number;
};

type DealPacketRow = {
  property_notes: string | null;
  investor_summary: string | null;
  buyer_email_blast: string | null;
  buyer_sms_alert: string | null;
  contact_instructions: string | null;
  deadline_to_submit_offer: string | null;
  comps_placeholder: string[] | null;
};

type ContractRow = {
  contract_sent: boolean | null;
  contract_signed: boolean | null;
  inspection_period: string | null;
  earnest_money_deposit: number | null;
  assignment_status: string | null;
};

type DealRoomRow = {
  slug: string | null;
  property_summary: string | null;
  financial_breakdown: string[] | null;
  map_placeholder: string | null;
  comps_placeholder: string[] | null;
  downloadable_pdf_label: string | null;
  submit_interest_label: string | null;
  request_walkthrough_label: string | null;
};

type DispositionLogRow = {
  id: string | number;
  action_type: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

function getEnvState(): EnvState {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const missing = required.filter((key) => !process.env[key]?.trim());

  return {
    enabled: missing.length === 0,
    missing,
  };
}

function getSupabaseAdmin(): SupabaseClient | null {
  const env = getEnvState();
  if (!env.enabled) return null;

  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asSingle<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function toLead(row: DealLeadJoin): DealEngineLead {
  const analysis = asSingle(row.deal_analysis);
  const conversation = asSingle(row.seller_conversations);
  const buyerMatch = asSingle(row.buyer_matches);

  return {
    id: row.id,
    ownerName: row.owner_name ?? "Unknown owner",
    ownerPhone: undefined,
    phoneStatus: "Skip Trace Needed",
    skipTraceStatus: "Queued",
    phoneSource: "Deal Engine workflow",
    contactEnrichmentNotes: "No verified seller phone is stored on this deal yet. Run skip trace and confirm the best number before outreach.",
    propertyAddress: row.property_address ?? "Unknown property",
    county: row.county ?? "Unknown",
    status: row.status ?? "Imported",
    motivationScore: asNumber(row.motivation_score),
    mao: formatCurrency(asNumber(analysis?.maximum_allowable_offer)),
    assignmentFee: formatCurrency(asNumber(analysis?.assignment_fee_target)),
    exitStrategy: buyerMatch?.exit_strategy?.trim() || "Exit strategy still being modeled",
    nextAction:
      conversation?.next_action?.trim()
      || row.recommended_next_action?.trim()
      || "Advance underwriting and prepare the next acquisition touchpoint.",
  };
}

function buildMetrics(leads: DealEngineLead[]) {
  if (!leads.length) return [...fallbackMetrics];

  const offerReadyCount = leads.filter((lead) => lead.status === "Offer Ready").length;
  const negotiatingCount = leads.filter((lead) => lead.status === "Negotiating").length;
  const assignmentVolume = leads.reduce((sum, lead) => {
    const parsed = Number(lead.assignmentFee.replace(/[^0-9.-]/g, ""));
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  return [
    {
      label: "Qualified Leads In Command",
      value: String(leads.length).padStart(2, "0"),
      detail: "Seller Engine handoffs currently living inside underwriting and acquisition flow.",
    },
    {
      label: "Offers Ready",
      value: String(offerReadyCount).padStart(2, "0"),
      detail: "Deals already modeled with target pricing and ready for seller-facing movement.",
    },
    {
      label: "Negotiating",
      value: String(negotiatingCount).padStart(2, "0"),
      detail: "Live acquisition conversations where price, timing, or terms are moving right now.",
    },
    {
      label: "Projected Assignment Fees",
      value: formatCurrency(assignmentVolume),
      detail: "Modeled fee volume across the live command queue.",
    },
  ] satisfies DealEngineMetric[];
}

function toSellerSignal(lead: SellerLeadView): DealEngineSellerSignal {
  return {
    id: lead.id,
    ownerName: lead.ownerName,
    ownerPhone: lead.ownerPhone,
    phoneStatus: lead.phoneStatus,
    skipTraceStatus: lead.skipTraceStatus,
    phoneSource: lead.phoneSource,
    contactEnrichmentNotes: lead.contactEnrichmentNotes,
    propertyAddress: lead.propertyAddress,
    county: lead.county,
    status: lead.status,
    score: lead.score,
    sourceName: lead.sourceName,
    summary: lead.summary,
    recommendedAction: lead.recommendedAction,
  };
}

function toBuyerReportView(report: BuyerReportRecord, jobs: SearchJobRecord[]): BuyerReportView {
  const job = report.search_job_id
    ? jobs.find((item) => item.id === report.search_job_id) ?? null
    : null;

  return {
    id: report.id,
    searchJobId: report.search_job_id ?? "unknown-job",
    county: job?.county ?? null,
    state: job?.state ?? null,
    propertyType: job?.property_type ?? null,
    buyerName: report.buyer_name_snapshot ?? "Unknown buyer",
    mailingAddress: report.mailing_address_snapshot ?? "No mailing address",
    score: report.score ?? 0,
    purchaseCount: report.purchase_count ?? 0,
    totalSpend: Number(report.total_spend ?? 0),
  };
}

function buildBuyerSignal(
  report: BuyerReportView,
  draft: { subject: string; angle: string } | null,
): DealEngineBuyerSignal {
  return {
    id: report.id,
    buyerName: report.buyerName,
    mailingAddress: report.mailingAddress,
    market:
      report.county && report.state
        ? `${report.county}, ${report.state}`
        : "Market still resolving",
    propertyType: report.propertyType?.replaceAll("_", " ") ?? "Unknown",
    score: report.score,
    purchaseCount: report.purchaseCount,
    totalSpend: formatCurrency(report.totalSpend),
    searchJobId: report.searchJobId,
    outreachSubject: draft?.subject || `Buyer activation for ${report.buyerName}`,
    outreachAngle:
      draft?.angle
      || "Reference recent acquisition activity and ask whether the buyer is still active in this lane.",
  };
}

function deriveOfferWindow(mao: string, assignmentFee: string) {
  const maoValue = Number(mao.replace(/[^0-9.-]/g, ""));
  const assignmentValue = Number(assignmentFee.replace(/[^0-9.-]/g, ""));
  const low = Number.isFinite(maoValue) ? Math.max(maoValue - Math.max(assignmentValue / 2, 5000), 0) : 0;
  const high = Number.isFinite(maoValue) ? maoValue : 0;
  return `${formatCurrency(low)} - ${formatCurrency(high)}`;
}

function buildContractDrafts(
  leads: DealEngineLead[],
  sellerSignals: DealEngineSellerSignal[],
  buyerSignals: DealEngineBuyerSignal[],
) {
  if (!leads.length) return [...fallbackContractDrafts];

  return leads.slice(0, 3).map((lead) => {
    const sellerSignal =
      sellerSignals.find((item) => item.county === lead.county)
      ?? sellerSignals[0]
      ?? null;
    const buyerSignal =
      buyerSignals.find((item) => item.market.toLowerCase().includes(lead.county.toLowerCase()))
      ?? buyerSignals[0]
      ?? null;

    return {
      dealId: lead.id,
      propertyAddress: lead.propertyAddress,
      sellerName: lead.ownerName,
      contractType: /wholesale|flip/i.test(lead.exitStrategy)
        ? "Assignable purchase agreement"
        : "Direct purchase with assignment fallback",
      offerWindow: deriveOfferWindow(lead.mao, lead.assignmentFee),
      earnestMoney: lead.motivationScore >= 85 ? "$5,000" : "$3,000",
      outreachLead:
        sellerSignal?.recommendedAction
        || "Lead with speed, certainty, and a clean as-is close path.",
      buyerDispositionNote:
        buyerSignal
          ? `${buyerSignal.buyerName} already fits this lane. ${buyerSignal.outreachAngle}`
          : "Prepare a buyer-facing packet and activate the strongest matching investor cohort.",
      nextSteps: [
        lead.nextAction,
        sellerSignal
          ? `Carry over Seller Engine summary: ${sellerSignal.summary}`
          : "Pull seller intelligence notes into the acquisition script.",
        buyerSignal
          ? `Stage buyer handoff using ${buyerSignal.searchJobId}.`
          : "Assemble disposition-ready buyer packet once the contract is signed.",
      ],
    };
  });
}

export function getDealEngineEnvStatus() {
  return getEnvState();
}

export async function listDealEngineLeads(limit = 6): Promise<DealEngineLead[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return fallbackLeads.slice(0, limit);

  const { data, error } = await supabase
    .from("deal_leads")
    .select(
      "id,owner_name,property_address,county,status,motivation_score,recommended_next_action,deal_analysis(maximum_allowable_offer,assignment_fee_target),seller_conversations(next_action),buyer_matches(exit_strategy)",
    )
    .order("motivation_score", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return fallbackLeads.slice(0, limit);
  return (data as unknown as DealLeadJoin[]).map(toLead);
}

export async function listDealEngineSellerSignals(limit = 4): Promise<DealEngineSellerSignal[]> {
  try {
    const leads = await listSellerLeads();
    const prioritized = leads
      .filter((lead) => lead.status !== "Dead Lead")
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(toSellerSignal);
    return prioritized.length ? prioritized : fallbackSellerSignals.slice(0, limit);
  } catch {
    return (DEMO_SELLER_LEADS.length ? DEMO_SELLER_LEADS : fallbackSellerSignals)
      .slice(0, limit)
      .map((lead) =>
        "summary" in lead
          ? toSellerSignal(lead as SellerLeadView)
          : fallbackSellerSignals[0],
      )
      .filter((lead): lead is DealEngineSellerSignal => Boolean(lead));
  }
}

export async function listDealEngineBuyerSignals(limit = 4): Promise<DealEngineBuyerSignal[]> {
  const env = getEnvState();
  if (!env.enabled) return fallbackBuyerSignals.slice(0, limit);

  try {
    const reportPage = await listAllBuyerReports({ limit: Math.max(limit * 3, 12), offset: 0 });
    if (!reportPage.reports.length) return fallbackBuyerSignals.slice(0, limit);

    const jobs = await listSearchJobsByIds(
      reportPage.reports
        .map((report) => report.search_job_id)
        .filter((id): id is string => Boolean(id)),
    ).catch(() => []);
    const drafts = await listOutreachDraftRecords().catch(() => []);

    const signals = reportPage.reports
      .map((report) => {
        const normalized = toBuyerReportView(report, jobs);
        const draft = drafts.find((item) => item.searchJobId === normalized.searchJobId);
        return buildBuyerSignal(normalized, draft ? { subject: draft.subject, angle: draft.angle } : null);
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return signals.length ? signals : fallbackBuyerSignals.slice(0, limit);
  } catch {
    return fallbackBuyerSignals.slice(0, limit);
  }
}

function createDealId() {
  return `DE-${Math.floor(1000 + Math.random() * 9000)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

type CreateDealFromSellerLeadInput = {
  sellerLeadId: string;
};

type SaveDealContractInput = {
  dealId: string;
  contractType: string;
  offerLow: number;
  offerHigh: number;
  earnestMoney: number;
};

type CreateDealOutreachDraftInput = {
  dealId: string;
  buyerSignalId: string;
};

type SaveDealPacketInput = {
  dealId: string;
  propertyNotes: string;
  investorSummary: string;
  buyerEmailBlast: string;
  buyerSmsAlert: string;
  contactInstructions: string;
  deadlineToSubmitOffer: string;
  comps: string[];
};

type SaveInvestorInterestInput = {
  slug: string;
  investorName: string;
  investorEmail: string;
  interestType: string;
  notes: string;
  preferredWalkthroughAt: string;
  attendeeCount: string;
  proofOfFundsStatus: string;
};

type SaveDealStageUpdateInput = {
  dealId: string;
  status: string;
  nextAction: string;
  note: string;
};

type SaveInvestorFollowUpInput = {
  dealId: string;
  investorEmail: string;
  followUpStatus: string;
  followUpOwner: string;
  nextStep: string;
  notes: string;
};

type SaveOperatorTaskInput = {
  dealId: string;
  taskId?: string;
  title: string;
  owner: string;
  dueDate: string;
  priority: string;
  status: string;
  notes: string;
};

type SaveDealCoordinationInput = {
  dealId: string;
  titleCompany: string;
  titleOfficer: string;
  walkthroughAt: string;
  inspectionEndsOn: string;
  closingDate: string;
  buyerAssignmentStatus: string;
  earnestMoneyStatus: string;
  payoutStatus: string;
  contractSent: boolean;
  contractSigned: boolean;
  coordinationNotes: string;
  closingChecklist: Array<{
    id: string;
    title: string;
    status: string;
    owner: string;
    dueDate: string;
  }>;
  closingDocuments: Array<{
    id: string;
    name: string;
    status: string;
    owner: string;
    notes: string;
  }>;
};

type SaveSellerOutreachDraftInput = {
  dealId: string;
  kind: string;
  title: string;
  body: string;
};

function buildDraftBody(input: {
  buyerName: string;
  market: string;
  propertyType: string;
  propertyAddress: string;
  score: number;
  purchaseCount: number;
  totalSpend: string;
}) {
  return [
    `Hi ${input.buyerName},`,
    "",
    `Blackspire is packaging a ${input.propertyType.toLowerCase()} opportunity at ${input.propertyAddress}.`,
    `Your acquisition activity in ${input.market} and current score of ${input.score} suggest this may fit your lane.`,
    `We saw ${input.purchaseCount} recent purchases and roughly ${input.totalSpend} in visible deployment across this market.`,
    "",
    "Are you still actively buying this profile right now? If so, I can send the packet and next-step details immediately.",
    "",
    "Blackspire Deal Engine",
  ].join("\n");
}

function buildFallbackPacket(
  lead: DealEngineLead,
  contractDraft: DealEngineContractDraft | null,
  buyerSignals: DealEngineBuyerSignal[],
): DealEngineDealDetail["packet"] {
  const buyerSignal = buyerSignals[0] ?? null;
  return {
    propertyNotes: `${lead.propertyAddress} is being staged inside Blackspire Deal Engine. Validate scope, condition, access, and clean-close positioning before broad buyer release.`,
    investorSummary: contractDraft?.buyerDispositionNote ?? "Investor summary still being assembled.",
    buyerEmailBlast: buyerSignal
      ? `Blackspire has a ${lead.county} opportunity aligned to active buyers like ${buyerSignal.buyerName}. Packet available on request.`
      : `Blackspire has a ${lead.county} opportunity currently moving through underwriting.`,
    buyerSmsAlert: `${lead.county} deal lane active. ${lead.propertyAddress}. Reach out for packet.`,
    contactInstructions: "Coordinate all buyer questions and walkthrough requests through Blackspire Deal Engine.",
    deadlineToSubmitOffer: "TBD",
    comps: ["Comp A", "Comp B", "Comp C"],
  };
}

function buildFallbackRoom(lead: DealEngineLead, packet: DealEngineDealDetail["packet"]) {
  return {
    slug: slugify(lead.propertyAddress),
    propertySummary: `Blackspire Helix Group presents ${lead.propertyAddress} as a private investor opportunity staged through Deal Engine.`,
    financialBreakdown: [
      `MAO: ${lead.mao}`,
      `Assignment Fee Target: ${lead.assignmentFee}`,
      `Offer Deadline: ${packet.deadlineToSubmitOffer}`,
    ],
    mapPlaceholder: "Detailed map and parcel overlays available through Blackspire upon request.",
    compsPlaceholder: packet.comps,
    downloadablePdfLabel: "Download Blackspire deal packet",
    submitInterestLabel: "Submit investor interest",
    requestWalkthroughLabel: "Request walkthrough",
  };
}

function buildFallbackCoordination(
  lead: DealEngineLead,
  contractDraft: DealEngineContractDraft | null,
): DealEngineDealDetail["coordination"] {
  return {
    titleCompany: `${lead.county} County title partner`,
    titleOfficer: "Unassigned",
    walkthroughAt: "",
    inspectionEndsOn: contractDraft ? "14 days from signed contract" : "",
    closingDate: "",
    buyerAssignmentStatus: "Packaging buyer handoff",
    earnestMoneyStatus: contractDraft ? `Target ${contractDraft.earnestMoney}` : "Not funded",
    payoutStatus: "Awaiting close statement",
    contractSent: false,
    contractSigned: false,
    coordinationNotes: "Use this lane to coordinate title, walkthrough access, signatures, and close-table readiness.",
    closingChecklist: [
      {
        id: "checklist-title",
        title: "Confirm title company and escrow contact",
        status: "Open",
        owner: "Disposition coordinator",
        dueDate: "",
      },
      {
        id: "checklist-walkthrough",
        title: "Schedule buyer walkthrough or access window",
        status: "Open",
        owner: "Acquisitions / Dispo",
        dueDate: "",
      },
      {
        id: "checklist-assignment",
        title: "Verify earnest money and assignment paperwork",
        status: "Open",
        owner: "Closer",
        dueDate: "",
      },
      {
        id: "checklist-statement",
        title: "Review closing statement and payout timing",
        status: "Open",
        owner: "Operator",
        dueDate: "",
      },
    ],
    closingDocuments: [
      {
        id: "document-purchase",
        name: "Purchase agreement",
        status: "Requested",
        owner: "Closer",
        notes: "",
      },
      {
        id: "document-assignment",
        name: "Assignment agreement",
        status: "Requested",
        owner: "Disposition coordinator",
        notes: "",
      },
      {
        id: "document-emd",
        name: "Earnest money receipt",
        status: "Requested",
        owner: "Operator",
        notes: "",
      },
      {
        id: "document-closing-statement",
        name: "Closing statement / HUD or ALTA",
        status: "Requested",
        owner: "Title officer",
        notes: "",
      },
    ],
  };
}

function buildSellerContactProfile(
  lead: DealEngineLead,
  sellerSignal: DealEngineSellerSignal | null,
): DealEngineDealDetail["sellerContact"] {
  return {
    ownerName: sellerSignal?.ownerName ?? lead.ownerName,
    ownerPhone: sellerSignal?.ownerPhone?.trim() || lead.ownerPhone?.trim() || "Not captured",
    phoneStatus: sellerSignal?.phoneStatus?.trim() || lead.phoneStatus?.trim() || "Skip Trace Needed",
    skipTraceStatus:
      sellerSignal?.skipTraceStatus?.trim()
      || lead.skipTraceStatus?.trim()
      || (sellerSignal?.ownerPhone?.trim() || lead.ownerPhone?.trim() ? "Verify Number" : "Queued"),
    phoneSource: sellerSignal?.phoneSource?.trim() || lead.phoneSource?.trim() || "Deal Engine workflow",
    contactEnrichmentNotes:
      sellerSignal?.contactEnrichmentNotes?.trim()
      || lead.contactEnrichmentNotes?.trim()
      || "Seller contact enrichment is still open. Capture and verify the best number before outreach.",
  };
}

function normalizeContactMatch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeNexusContactProfile(
  sellerContact: DealEngineDealDetail["sellerContact"],
  contact: NexusContactRow | null,
): DealEngineDealDetail["sellerContact"] {
  if (!contact) return sellerContact;

  const primaryPhone = contact.primary_phone?.trim();
  const primaryEmail = contact.primary_email?.trim();
  const provider = contact.provider?.trim() || "Nexus";
  const status = contact.status?.trim() || sellerContact.skipTraceStatus;
  const confidence = contact.contact_confidence_score != null ? ` Confidence ${contact.contact_confidence_score}.` : "";

  return {
    ...sellerContact,
    ownerName: contact.owner_name?.trim() || sellerContact.ownerName,
    ownerPhone: primaryPhone || sellerContact.ownerPhone,
    phoneStatus: primaryPhone ? "Trace Complete" : sellerContact.phoneStatus,
    skipTraceStatus: status,
    phoneSource: primaryPhone ? `${provider} API` : sellerContact.phoneSource,
    contactEnrichmentNotes:
      primaryPhone || primaryEmail
        ? `Nexus saved a ${provider} contact profile for this deal.${primaryPhone ? ` Primary phone ${primaryPhone}.` : ""}${primaryEmail ? ` Primary email ${primaryEmail}.` : ""}${confidence} Verify compliance posture before outreach.`
        : sellerContact.contactEnrichmentNotes,
  };
}

async function findNexusContactForDeal(
  supabase: SupabaseClient,
  lead: DealEngineLead,
): Promise<NexusContactRow | null> {
  const { data, error } = await supabase
    .from("nexus_contacts")
    .select("owner_name,property_address,mailing_address,primary_phone,primary_email,contact_confidence_score,provider,status,updated_at")
    .eq("owner_name", lead.ownerName)
    .eq("property_address", lead.propertyAddress)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) return data as NexusContactRow;

  const { data: recentContacts, error: recentError } = await supabase
    .from("nexus_contacts")
    .select("owner_name,property_address,mailing_address,primary_phone,primary_email,contact_confidence_score,provider,status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  if (recentError || !recentContacts?.length) return null;
  return (recentContacts as NexusContactRow[]).find((contact) =>
    normalizeContactMatch(contact.owner_name) === normalizeContactMatch(lead.ownerName)
    && normalizeContactMatch(contact.property_address) === normalizeContactMatch(lead.propertyAddress)
  ) ?? null;
}

function buildSellerContactWorkflow(
  lead: DealEngineLead,
  sellerContact: DealEngineDealDetail["sellerContact"],
): DealEngineDealDetail["sellerContactWorkflow"] {
  const hasPhone = sellerContact.ownerPhone !== "Not captured";
  return [
    {
      id: `${lead.id}-contact-source`,
      title: "Check intake source for direct contact data",
      detail: `Confirm whether Seller Engine, manual intake, or source docs already have a usable phone for ${sellerContact.ownerName}.`,
      status: hasPhone ? "ready" : "active",
    },
    {
      id: `${lead.id}-skip-trace`,
      title: hasPhone ? "Verify best seller number" : "Run skip trace and verify best seller number",
      detail: hasPhone
        ? "A number is present. Verify it is current, mobile-capable, and approved for first-touch outreach."
        : "No number is stored. Pull contact enrichment, rank the likely numbers, and verify the best path for Carlos Pearson and Blackspire Helix Group outreach.",
      status: "active",
    },
    {
      id: `${lead.id}-compliance`,
      title: "Confirm compliance posture before outreach",
      detail: "Check DNC / opt-out posture, note the approved contact channel, and document any family or title-sensitive handling.",
      status: "ready",
    },
    {
      id: `${lead.id}-first-touch`,
      title: "Launch first-touch seller outreach and log the result",
      detail: "Once the number is verified, send the first-touch Carlos Pearson / Blackspire Helix Group script and log the response or no-answer outcome back into the deal.",
      status: hasPhone ? "ready" : "blocked",
    },
  ];
}

function buildSellerOutreach(
  lead: DealEngineLead,
  sellerSignal: DealEngineSellerSignal | null,
  sellerContact: DealEngineDealDetail["sellerContact"],
  contractDraft: DealEngineContractDraft | null,
): DealEngineDealDetail["sellerOutreach"] {
  const ownerName = sellerContact.ownerName || lead.ownerName;
  const address = lead.propertyAddress;
  const county = lead.county;
  const summary =
    sellerSignal?.summary
    || "We help sellers who want a simpler direct-sale path without repair prep or listing friction.";
  const action =
    sellerSignal?.recommendedAction
    || lead.nextAction
    || "Lead with certainty, as-is terms, and a simple close path.";
  const pricing = contractDraft?.offerWindow || `around ${lead.mao}`;
  const closeAngle = contractDraft?.outreachLead || "clean close, as-is terms, and clear next steps";

  return {
    firstTouchSms: `Hi ${ownerName}, this is Carlos with Blackspire Helix Group. I'm reaching out about ${address}. We work with owners in ${county} who want a direct as-is sale without repairs or listing prep. If you'd consider an offer, I can keep it simple and low-pressure.`,
    followUpSms: `Hi ${ownerName}, Carlos from Blackspire here following up on ${address}. We may be able to structure a straightforward close ${pricing ? `in the ${pricing} range` : ""} depending on condition and timing. If convenience matters more than listing it, I can walk you through a clean option.`,
    emailSubject: `Direct sale option for ${address}`,
    emailBody: `Hi ${ownerName},\n\nThis is Carlos Pearson with Blackspire Helix Group. I'm reaching out about ${address} because we help sellers who want a direct, as-is option instead of preparing a home for the market.\n\nFrom our side, the goal would be ${closeAngle}. ${summary}\n\nIf selling is something you're open to, I can outline what a simple next step looks like and answer any questions without pressure.\n\nBest,\nCarlos Pearson\nBlackspire Helix Group`,
    objectionReply: `I completely understand. Many owners we speak with are weighing whether a direct sale is worth it versus listing. The main value on our side is speed, simplicity, and fewer moving parts. ${action} If now is not the right time, I’m happy to stay respectful and circle back only if you want me to.`,
    voicemailScript: `Hi ${ownerName}, this is Carlos with Blackspire Helix Group calling about ${address}. We work with owners looking for a simple as-is sale and I wanted to see whether you might be open to a direct offer. You can call or text me back whenever it’s convenient.`,
    callOpener: `Hi ${ownerName}, this is Carlos Pearson with Blackspire Helix Group. I’m calling about ${address}. Did I catch you at an okay time for a quick question about the property?`,
  };
}

function buildInitialContactTask(leadId: string, ownerName: string, ownerPhone?: string) {
  const now = new Date().toISOString();
  return {
    lead_id: leadId,
    action_type: "operator_task",
    payload: {
      taskId: `contact-enrichment-${leadId}`,
      title: ownerPhone?.trim()
        ? `Verify seller phone and launch first-touch for ${ownerName}`
        : `Skip trace and verify seller phone for ${ownerName}`,
      owner: "Acquisitions",
      dueDate: "",
      priority: "High",
      status: "Open",
      notes: ownerPhone?.trim()
        ? "A phone is attached. Verify it is the best number, confirm compliance posture, and launch the first-touch sequence."
        : "No seller phone is stored. Run skip trace, verify the best number, record the source, and prep the first-touch sequence before acquisition outreach.",
      createdAt: now,
      updatedAt: now,
    },
  };
}

function buildDefaultContactOperatorTask(
  lead: DealEngineLead,
  sellerContact: DealEngineDealDetail["sellerContact"],
): DealEngineDealDetail["operatorTasks"][number] {
  const now = new Date().toISOString();
  return {
    id: `contact-enrichment-${lead.id}`,
    title:
      sellerContact.ownerPhone === "Not captured"
        ? `Skip trace and verify seller phone for ${sellerContact.ownerName}`
        : `Verify seller phone and launch first-touch for ${sellerContact.ownerName}`,
    owner: "Acquisitions",
    dueDate: "",
    priority: "High",
    status: "Open",
    notes:
      sellerContact.ownerPhone === "Not captured"
        ? "No seller phone is stored. Run skip trace, verify the best number, and prep first-touch outreach."
        : "A phone is attached. Verify it is current, confirm compliance posture, and launch outreach.",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeChecklistItems(
  value: unknown,
  fallback: DealEngineDealDetail["coordination"]["closingChecklist"],
): DealEngineDealDetail["coordination"]["closingChecklist"] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `legacy-checklist-${index + 1}`,
        title: item,
        status: "Open",
        owner: "Unassigned",
        dueDate: "",
      };
    }
    const payload = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = String(payload.title ?? payload.label ?? "").trim();
    if (!title) return null;
    return {
      id: String(payload.id ?? `checklist-${index + 1}`),
      title,
      status: String(payload.status ?? "Open"),
      owner: String(payload.owner ?? "Unassigned"),
      dueDate: String(payload.dueDate ?? ""),
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return items.length ? items : fallback;
}

function normalizeClosingDocuments(
  value: unknown,
  fallback: DealEngineDealDetail["coordination"]["closingDocuments"],
): DealEngineDealDetail["coordination"]["closingDocuments"] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `legacy-document-${index + 1}`,
        name: item,
        status: "Requested",
        owner: "Unassigned",
        notes: "",
      };
    }
    const payload = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = String(payload.name ?? payload.title ?? payload.label ?? "").trim();
    if (!name) return null;
    return {
      id: String(payload.id ?? `document-${index + 1}`),
      name,
      status: String(payload.status ?? "Requested"),
      owner: String(payload.owner ?? "Unassigned"),
      notes: String(payload.notes ?? ""),
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return items.length ? items : fallback;
}

function normalizeStage(status: string) {
  const value = status.toLowerCase();
  if (value.includes("under contract") || value.includes("packet")) return "Contract / Packet";
  if (value.includes("buyer interest") || value.includes("marketed") || value.includes("disposition")) {
    return "Buyer Follow-Up";
  }
  if (value.includes("negotiating")) return "Negotiating";
  if (value.includes("offer ready")) return "Offer Ready";
  if (value.includes("analysis") || value.includes("review")) return "Underwriting";
  return "New Intake";
}

function buildStageBoard(leads: DealEngineLead[]) {
  const lanes = [
    {
      label: "New Intake",
      detail: "Fresh handoffs still being normalized from Seller Engine into Deal Engine.",
    },
    {
      label: "Underwriting",
      detail: "Live deals where MAO, condition, and contract strategy are still being shaped.",
    },
    {
      label: "Negotiating",
      detail: "Seller-facing conversations moving through price, timing, and term alignment.",
    },
    {
      label: "Offer Ready",
      detail: "Terms are assembled and the deal is nearly ready to paper or release.",
    },
    {
      label: "Contract / Packet",
      detail: "Deals with contract posture or packet work active ahead of buyer release.",
    },
    {
      label: "Buyer Follow-Up",
      detail: "Investor responses are in and the disposition lane now needs active follow-up.",
    },
  ] as const;

  return lanes.map((lane) => {
    const deals = leads.filter((lead) => normalizeStage(lead.status) === lane.label);
    return {
      label: lane.label,
      count: deals.length,
      detail: lane.detail,
      deals,
    };
  });
}

function parseDispositionLogs(logs: DispositionLogRow[]) {
  const followUps = new Map<string, {
    followUpStatus: string;
    followUpOwner: string;
    nextStep: string;
    notes: string;
    lastUpdatedAt: string;
  }>();

  for (const log of logs) {
    if (log.action_type !== "investor_follow_up") continue;
    const payload = log.payload ?? {};
    const investorEmail = String(payload.investorEmail ?? "").trim().toLowerCase();
    if (!investorEmail) continue;
    followUps.set(investorEmail, {
      followUpStatus: String(payload.followUpStatus ?? "New response"),
      followUpOwner: String(payload.followUpOwner ?? "Unassigned"),
      nextStep: String(payload.nextStep ?? "Review response and assign next move."),
      notes: String(payload.notes ?? ""),
      lastUpdatedAt: String(payload.updatedAt ?? log.created_at ?? new Date().toISOString()),
    });
  }

  return logs
    .filter((log) => log.action_type === "investor_interest")
    .map((log) => {
      const payload = log.payload ?? {};
      const investorEmail = String(payload.investorEmail ?? "").trim();
      const followUp = followUps.get(investorEmail.toLowerCase());
      return {
        id: String(log.id),
        investorName: String(payload.investorName ?? "Unknown investor"),
        investorEmail,
        interestType: String(payload.interestType ?? "Interested"),
        notes: String(payload.notes ?? ""),
        preferredWalkthroughAt: String(payload.preferredWalkthroughAt ?? ""),
        attendeeCount: String(payload.attendeeCount ?? ""),
        proofOfFundsStatus: String(payload.proofOfFundsStatus ?? ""),
        submittedAt: String(payload.submittedAt ?? log.created_at ?? new Date().toISOString()),
        followUpStatus: followUp?.followUpStatus ?? "New response",
        followUpOwner: followUp?.followUpOwner ?? "Unassigned",
        nextStep: followUp?.nextStep ?? "Review response and determine walkthrough or packet follow-up.",
        lastUpdatedAt: followUp?.lastUpdatedAt ?? String(log.created_at ?? new Date().toISOString()),
      };
    })
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt));
}

function parseOperatorTasks(logs: DispositionLogRow[]) {
  const tasks = new Map<string, DealEngineDealDetail["operatorTasks"][number]>();

  for (const log of logs) {
    if (log.action_type !== "operator_task") continue;
    const payload = log.payload ?? {};
    const taskId = String(payload.taskId ?? log.id);
    tasks.set(taskId, {
      id: taskId,
      title: String(payload.title ?? "Untitled task"),
      owner: String(payload.owner ?? "Unassigned"),
      dueDate: String(payload.dueDate ?? ""),
      priority: String(payload.priority ?? "Normal"),
      status: String(payload.status ?? "Open"),
      notes: String(payload.notes ?? ""),
      createdAt: String(payload.createdAt ?? log.created_at ?? new Date().toISOString()),
      updatedAt: String(payload.updatedAt ?? log.created_at ?? new Date().toISOString()),
    });
  }

  return [...tasks.values()].sort((left, right) => {
    const leftDue = Date.parse(left.dueDate || left.updatedAt);
    const rightDue = Date.parse(right.dueDate || right.updatedAt);
    return leftDue - rightDue;
  });
}

function parseSellerDrafts(logs: DispositionLogRow[]) {
  return logs
    .filter((log) => log.action_type === "seller_draft_saved")
    .map((log) => {
      const payload = log.payload ?? {};
      return {
        id: String(log.id),
        kind: String(payload.kind ?? "Seller draft"),
        title: String(payload.title ?? "Untitled seller draft"),
        body: String(payload.body ?? ""),
        createdAt: String(payload.createdAt ?? log.created_at ?? new Date().toISOString()),
      };
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function buildActivityFeed(logs: DispositionLogRow[]) {
  return logs.map((log) => {
    const payload = log.payload ?? {};
    const timestamp = String(log.created_at ?? new Date().toISOString());

    if (log.action_type === "investor_interest") {
      return {
        id: String(log.id),
        title: `Investor response: ${String(payload.investorName ?? "Unknown investor")}`,
        detail: String(payload.interestType ?? "Interested"),
        timestamp,
        tone: "good" as const,
      };
    }

    if (log.action_type === "investor_follow_up") {
      return {
        id: String(log.id),
        title: `Investor follow-up: ${String(payload.investorEmail ?? "Unknown investor")}`,
        detail: String(payload.nextStep ?? "Disposition follow-up updated."),
        timestamp,
        tone: "active" as const,
      };
    }

    if (log.action_type === "stage_update") {
      return {
        id: String(log.id),
        title: `Pipeline moved to ${String(payload.status ?? "Updated stage")}`,
        detail: String(payload.nextAction ?? "Next action updated."),
        timestamp,
        tone: "warn" as const,
      };
    }

    if (log.action_type === "contract_update") {
      return {
        id: String(log.id),
        title: "Contract posture updated",
        detail: String(payload.summary ?? "Contract terms were revised."),
        timestamp,
        tone: "good" as const,
      };
    }

    if (log.action_type === "packet_update") {
      return {
        id: String(log.id),
        title: "Disposition packet updated",
        detail: String(payload.summary ?? "Buyer-facing packet content changed."),
        timestamp,
        tone: "neutral" as const,
      };
    }

    if (log.action_type === "buyer_draft_created") {
      return {
        id: String(log.id),
        title: `Buyer draft created for ${String(payload.buyerName ?? "buyer lane")}`,
        detail: String(payload.subject ?? "Outreach draft saved."),
        timestamp,
        tone: "active" as const,
      };
    }

    if (log.action_type === "seller_draft_saved") {
      return {
        id: String(log.id),
        title: `Seller draft saved: ${String(payload.kind ?? "seller outreach")}`,
        detail: String(payload.title ?? "Seller outreach draft saved."),
        timestamp,
        tone: "active" as const,
      };
    }

    if (log.action_type === "operator_task") {
      return {
        id: String(log.id),
        title: `Task: ${String(payload.title ?? "Untitled task")}`,
        detail: `${String(payload.status ?? "Open")} / ${String(payload.owner ?? "Unassigned")}`,
        timestamp,
        tone: "neutral" as const,
      };
    }

    if (log.action_type === "coordination_update") {
      return {
        id: String(log.id),
        title: "Closing coordination updated",
        detail: String(payload.summary ?? "Title and closing coordination changed."),
        timestamp,
        tone: "active" as const,
      };
    }

    return {
      id: String(log.id),
      title: String(log.action_type ?? "Deal activity"),
      detail: "Deal activity recorded.",
      timestamp,
      tone: "neutral" as const,
    };
  }).sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export async function createDealFromSellerLead(input: CreateDealFromSellerLeadInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const sellerLead = (await listSellerLeads()).find((lead) => lead.id === input.sellerLeadId);
  if (!sellerLead) {
    return { ok: false as const, error: "Seller lead not found." };
  }

  const existing = await supabase
    .from("deal_leads")
    .select("id")
    .eq("property_address", sellerLead.propertyAddress)
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    await updateSellerLead(sellerLead.id, { status: "Sent to Deal Engine" });
    return { ok: true as const, dealId: String(existing.data.id), created: false as const };
  }

  const dealId = createDealId();
  const arv = Math.max(sellerLead.assessedValue * 1.18, sellerLead.assessedValue);
  const repairEstimate = sellerLead.signals.vacant || sellerLead.signals.codeViolation ? 35000 : 22000;
  const assignmentFee = sellerLead.score >= 85 ? 18000 : 12000;
  const mao = Math.max(Math.round(arv * 0.7 - repairEstimate - assignmentFee), 0);
  const buyerPrice = mao + assignmentFee;
  const roomSlug = slugify(sellerLead.propertyAddress);

  const operations = [
    supabase.from("deal_leads").insert({
      id: dealId,
      owner_name: sellerLead.ownerName,
      property_address: sellerLead.propertyAddress,
      mailing_address: sellerLead.ownerMailingAddress,
      county: sellerLead.county,
      city: sellerLead.city,
      zip_code: sellerLead.zipCode,
      motivation_score: sellerLead.score,
      motivation_reasons: sellerLead.reasons,
      property_type: sellerLead.propertyType,
      assessed_value: sellerLead.assessedValue,
      estimated_equity: sellerLead.estimatedEquity,
      source_data: `Seller Engine / ${sellerLead.sourceName}`,
      seller_dossier: sellerLead.summary,
      recommended_next_action: sellerLead.recommendedAction,
      status: "Needs Analysis",
    }),
    supabase.from("deal_analysis").insert({
      lead_id: dealId,
      estimated_arv: Math.round(arv),
      purchase_price_target: mao,
      seller_asking_price: sellerLead.assessedValue,
      repair_estimate: repairEstimate,
      closing_costs: 9000,
      holding_costs: 6000,
      buyer_profit_target: 30000,
      assignment_fee_target: assignmentFee,
      rental_estimate: 0,
      flip_estimate: 0,
      wholesale_spread: Math.max(Math.round(arv - buyerPrice), 0),
      maximum_allowable_offer: mao,
      formula_settings: { arvMultiplier: 0.7, assignmentFee },
      deal_rating: sellerLead.score >= 80 ? "Green Deal" : "Yellow Deal",
    }),
    supabase.from("seller_conversations").insert({
      lead_id: dealId,
      seller_asking_price: sellerLead.assessedValue,
      seller_motivation: sellerLead.summary,
      timeline: "Needs qualification",
      property_condition: sellerLead.signals.codeViolation ? "Condition concerns likely" : "Needs confirmation",
      mortgage_status: "Unknown",
      repairs_mentioned: sellerLead.signals.vacant ? "Vacancy and deferred maintenance likely" : "Unknown",
      decision_makers: sellerLead.ownerName,
      next_action: sellerLead.recommendedAction,
      notes: [sellerLead.summary],
      ai_suggestions: {
        nextMove: sellerLead.recommendedAction,
        conversationSummary: sellerLead.summary,
      },
    }),
    supabase.from("disposition_logs").insert(buildInitialContactTask(dealId, sellerLead.ownerName, sellerLead.ownerPhone)),
    supabase.from("buyer_matches").insert({
      lead_id: dealId,
      county: sellerLead.county,
      city: sellerLead.city,
      zip_code: sellerLead.zipCode,
      property_type: sellerLead.propertyType,
      arv_range: formatCurrency(Math.round(arv * 0.92)) + " - " + formatCurrency(Math.round(arv * 1.04)),
      purchase_price_range: `${formatCurrency(mao)} - ${formatCurrency(buyerPrice)}`,
      repair_level: repairEstimate >= 30000 ? "Medium-High" : "Medium",
      exit_strategy: sellerLead.propertyType.toLowerCase().includes("duplex") ? "BRRRR / Value Add" : "Wholesale / Flip",
      rental_potential: "Needs market rent confirmation",
      flip_potential: sellerLead.score >= 80 ? "High" : "Moderate",
      top_buyer_matches: [],
      buyer_score: 0,
      investor_type_recommendation: "Use Buyer Engine to shortlist best-fit active operators.",
      export_ready_deal_data: "Deal created from Seller Engine handoff.",
    }),
    supabase.from("contracts").insert({
      lead_id: dealId,
      offer_made: false,
      offer_accepted: false,
      contract_sent: false,
      contract_signed: false,
      inspection_period: "14 days",
      earnest_money_deposit: sellerLead.score >= 85 ? 5000 : 3000,
      assignment_status: "Drafting",
    }),
    supabase.from("deal_packets").insert({
      lead_id: dealId,
      property_notes: sellerLead.summary,
      investor_summary: `Blackspire is underwriting ${sellerLead.propertyAddress} for a ${sellerLead.propertyType.toLowerCase()} disposition path in ${sellerLead.county} County.`,
      buyer_email_blast: `Blackspire has a new ${sellerLead.county} County opportunity entering packet assembly.`,
      buyer_sms_alert: `${sellerLead.county} deal lane entering packet prep. Reply for details.`,
      contact_instructions: "Coordinate all buyer communication through Blackspire Deal Engine.",
      deadline_to_submit_offer: "",
      comps_placeholder: [],
    }),
    supabase.from("deal_rooms").insert({
      lead_id: dealId,
      slug: roomSlug,
      property_summary: `Blackspire Deal Engine assembled this opportunity from Seller Engine lead ${sellerLead.id}.`,
      financial_breakdown: [
        `MAO: ${formatCurrency(mao)}`,
        `Buyer Price: ${formatCurrency(buyerPrice)}`,
        `Assignment Fee Target: ${formatCurrency(assignmentFee)}`,
      ],
      photos: [],
      map_placeholder: "Map pending",
      comps_placeholder: [],
      downloadable_pdf_label: "Download Blackspire packet",
      submit_interest_label: "Submit investor interest",
      request_walkthrough_label: "Request walkthrough",
    }),
  ];

  for (const operation of operations) {
    const { error } = await operation;
    if (error) {
      return { ok: false as const, error: error.message };
    }
  }

  await updateSellerLead(sellerLead.id, { status: "Sent to Deal Engine" }).catch(() => null);
  return { ok: true as const, dealId, created: true as const };
}

export async function saveDealContractTerms(input: SaveDealContractInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const purchaseTarget = Math.round((input.offerLow + input.offerHigh) / 2);
  const offerMade = input.offerHigh > 0;

  const [contractUpdate, analysisUpdate, conversationUpdate, logInsert] = await Promise.all([
    supabase
      .from("contracts")
      .update({
        offer_made: offerMade,
        earnest_money_deposit: input.earnestMoney,
        assignment_status: input.contractType,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase
      .from("deal_analysis")
      .update({
        purchase_price_target: purchaseTarget,
        maximum_allowable_offer: input.offerHigh,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase
      .from("seller_conversations")
      .update({
        next_action: `Contract posture saved: ${input.contractType} / ${formatCurrency(input.offerLow)} to ${formatCurrency(input.offerHigh)}.`,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "contract_update",
      payload: {
        contractType: input.contractType,
        offerLow: input.offerLow,
        offerHigh: input.offerHigh,
        earnestMoney: input.earnestMoney,
        summary: `${input.contractType} / ${formatCurrency(input.offerLow)} to ${formatCurrency(input.offerHigh)} / earnest ${formatCurrency(input.earnestMoney)}`,
        updatedAt: new Date().toISOString(),
      },
    }),
  ]);

  const error =
    contractUpdate.error?.message
    || analysisUpdate.error?.message
    || conversationUpdate.error?.message
    || logInsert.error?.message;
  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const };
}

export async function createDealBuyerOutreachDraft(input: CreateDealOutreachDraftInput) {
  const deal = (await listDealEngineLeads(50)).find((item) => item.id === input.dealId);
  const buyerSignals = await listDealEngineBuyerSignals(20);
  const buyerSignal = buyerSignals.find((item) => item.id === input.buyerSignalId);

  if (!deal || !buyerSignal) {
    return { ok: false as const, error: "Deal or buyer signal could not be found." };
  }

  const record = {
    id: `${input.dealId}-${input.buyerSignalId}-${Date.now()}`,
    source: "buyers" as const,
    searchJobId: buyerSignal.searchJobId,
    buyerName: buyerSignal.buyerName,
    mailingAddress: buyerSignal.mailingAddress,
    county: buyerSignal.market.split(",")[0]?.trim() || null,
    state: buyerSignal.market.split(",")[1]?.trim() || null,
    propertyType: buyerSignal.propertyType,
    score: buyerSignal.score,
    purchaseCount: buyerSignal.purchaseCount,
    totalSpend: Number(buyerSignal.totalSpend.replace(/[^0-9.-]/g, "")),
    isLlc: /llc|capital|holdings|partners/i.test(buyerSignal.buyerName),
    isCashBuyer: buyerSignal.score >= 80,
    subject: `${deal.county} deal match for ${buyerSignal.buyerName}`,
    angle: buyerSignal.outreachAngle,
    body: buildDraftBody({
      buyerName: buyerSignal.buyerName,
      market: buyerSignal.market,
      propertyType: buyerSignal.propertyType,
      propertyAddress: deal.propertyAddress,
      score: buyerSignal.score,
      purchaseCount: buyerSignal.purchaseCount,
      totalSpend: buyerSignal.totalSpend,
    }),
    createdAt: new Date().toISOString(),
  };

  try {
    const drafts = await persistOutreachDraftRecord(record);
    const supabase = getSupabaseAdmin();
    if (supabase) {
      await supabase.from("disposition_logs").insert({
        lead_id: input.dealId,
        action_type: "buyer_draft_created",
        payload: {
          buyerName: record.buyerName,
          subject: record.subject,
          searchJobId: record.searchJobId,
          createdAt: record.createdAt,
        },
      });
    }
    return { ok: true as const, draft: record, drafts };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Buyer outreach draft persistence failed.",
    };
  }
}

export async function saveDealPacket(input: SaveDealPacketInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const payload = {
    lead_id: input.dealId,
    property_notes: input.propertyNotes,
    investor_summary: input.investorSummary,
    buyer_email_blast: input.buyerEmailBlast,
    buyer_sms_alert: input.buyerSmsAlert,
    contact_instructions: input.contactInstructions,
    deadline_to_submit_offer: input.deadlineToSubmitOffer,
    comps_placeholder: input.comps,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("deal_packets")
    .upsert(payload, { onConflict: "lead_id" });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  await supabase.from("disposition_logs").insert({
    lead_id: input.dealId,
    action_type: "packet_update",
    payload: {
      deadlineToSubmitOffer: input.deadlineToSubmitOffer,
      compsCount: input.comps.length,
      summary: `Packet saved with ${input.comps.length} comps and deadline ${input.deadlineToSubmitOffer || "TBD"}.`,
      updatedAt: new Date().toISOString(),
    },
  });

  return { ok: true as const };
}

export async function saveInvestorInterest(input: SaveInvestorInterestInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const { data: room } = await supabase
    .from("deal_rooms")
    .select("lead_id")
    .eq("slug", input.slug)
    .maybeSingle();

  const leadId = room && typeof room === "object" && "lead_id" in room ? String(room.lead_id) : null;
  if (!leadId) {
    return { ok: false as const, error: "Deal room not found." };
  }

  const { error } = await supabase.from("disposition_logs").insert({
    lead_id: leadId,
    action_type: "investor_interest",
    payload: {
      investorName: input.investorName,
      investorEmail: input.investorEmail,
      interestType: input.interestType,
      notes: input.notes,
      preferredWalkthroughAt: input.preferredWalkthroughAt,
      attendeeCount: input.attendeeCount,
      proofOfFundsStatus: input.proofOfFundsStatus,
      submittedAt: new Date().toISOString(),
    },
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}

export async function saveDealStageUpdate(input: SaveDealStageUpdateInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const [leadUpdate, conversationUpdate, logInsert] = await Promise.all([
    supabase
      .from("deal_leads")
      .update({
        status: input.status,
        recommended_next_action: input.nextAction,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.dealId),
    supabase
      .from("seller_conversations")
      .update({
        next_action: input.nextAction,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "stage_update",
      payload: {
        status: input.status,
        nextAction: input.nextAction,
        note: input.note,
        updatedAt: new Date().toISOString(),
      },
    }),
  ]);

  const error = leadUpdate.error?.message || conversationUpdate.error?.message || logInsert.error?.message;
  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const };
}

export async function saveInvestorFollowUp(input: SaveInvestorFollowUpInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const normalizedStatus = input.followUpStatus.trim() || "Investor follow-up";
  const nextAction =
    input.nextStep.trim()
    || `Continue investor follow-up with ${input.investorEmail} under ${normalizedStatus}.`;

  const [leadUpdate, conversationUpdate, logInsert] = await Promise.all([
    supabase
      .from("deal_leads")
      .update({
        status: "Buyer Follow-Up",
        recommended_next_action: nextAction,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.dealId),
    supabase
      .from("seller_conversations")
      .update({
        next_action: `Buyer follow-up active: ${nextAction}`,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "investor_follow_up",
      payload: {
        investorEmail: input.investorEmail,
        followUpStatus: normalizedStatus,
        followUpOwner: input.followUpOwner,
        nextStep: nextAction,
        notes: input.notes,
        updatedAt: new Date().toISOString(),
      },
    }),
  ]);

  const error = leadUpdate.error?.message || conversationUpdate.error?.message || logInsert.error?.message;
  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const };
}

export async function saveOperatorTask(input: SaveOperatorTaskInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const taskId = input.taskId?.trim() || `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();
  const { error } = await supabase.from("disposition_logs").insert({
    lead_id: input.dealId,
    action_type: "operator_task",
    payload: {
      taskId,
      title: input.title,
      owner: input.owner,
      dueDate: input.dueDate,
      priority: input.priority,
      status: input.status,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    },
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const, taskId };
}

export async function saveDealCoordination(input: SaveDealCoordinationInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const [contractUpdate, conversationUpdate, logInsert] = await Promise.all([
    supabase
      .from("contracts")
      .update({
        contract_sent: input.contractSent,
        contract_signed: input.contractSigned,
        inspection_period: input.inspectionEndsOn || null,
        assignment_status: input.buyerAssignmentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase
      .from("seller_conversations")
      .update({
        next_action: `Closing coordination: ${input.titleCompany || "title not assigned"} / ${input.closingDate || "closing TBD"}.`,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "coordination_update",
      payload: {
        titleCompany: input.titleCompany,
        titleOfficer: input.titleOfficer,
        walkthroughAt: input.walkthroughAt,
        inspectionEndsOn: input.inspectionEndsOn,
        closingDate: input.closingDate,
        buyerAssignmentStatus: input.buyerAssignmentStatus,
        earnestMoneyStatus: input.earnestMoneyStatus,
        payoutStatus: input.payoutStatus,
        contractSent: input.contractSent,
        contractSigned: input.contractSigned,
        coordinationNotes: input.coordinationNotes,
        closingChecklist: input.closingChecklist,
        closingDocuments: input.closingDocuments,
        summary: `${input.titleCompany || "Title TBD"} / close ${input.closingDate || "TBD"} / ${input.payoutStatus || "payout pending"}`,
        updatedAt: new Date().toISOString(),
      },
    }),
  ]);

  const error = contractUpdate.error?.message || conversationUpdate.error?.message || logInsert.error?.message;
  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const };
}

export async function saveSellerOutreachDraft(input: SaveSellerOutreachDraftInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const createdAt = new Date().toISOString();
  const { error } = await supabase.from("disposition_logs").insert({
    lead_id: input.dealId,
    action_type: "seller_draft_saved",
    payload: {
      kind: input.kind,
      title: input.title,
      body: input.body,
      createdAt,
    },
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}

export async function getDealEngineDealDetail(dealId: string): Promise<DealEngineDealDetail | null> {
  const [leads, sellerSignals, buyerSignals, drafts] = await Promise.all([
    listDealEngineLeads(100),
    listDealEngineSellerSignals(12),
    listDealEngineBuyerSignals(20),
    listOutreachDraftRecords().catch(() => []),
  ]);

  const lead = leads.find((item) => item.id === dealId);
  if (!lead) return null;

  const contractDraft = buildContractDrafts(leads, sellerSignals, buyerSignals).find(
    (item) => item.dealId === dealId,
  ) ?? null;
  const sellerSignal =
    sellerSignals.find((item) => item.propertyAddress === lead.propertyAddress)
    ?? sellerSignals.find((item) => item.county === lead.county)
    ?? null;
  let sellerContact = buildSellerContactProfile(lead, sellerSignal);
  let sellerContactWorkflow = buildSellerContactWorkflow(lead, sellerContact);
  let sellerOutreach = buildSellerOutreach(lead, sellerSignal, sellerContact, contractDraft);
  const relatedBuyerSignals = buyerSignals.filter(
    (item) => item.market.toLowerCase().includes(lead.county.toLowerCase()),
  );
  const relatedDrafts = drafts
    .filter((draft) => relatedBuyerSignals.some((item) => item.searchJobId === draft.searchJobId))
    .slice(0, 8)
    .map((draft) => ({
      id: draft.id,
      buyerName: draft.buyerName,
      subject: draft.subject,
      angle: draft.angle,
      body: draft.body,
      createdAt: draft.createdAt,
    }));
  let sellerDrafts: DealEngineDealDetail["sellerDrafts"] = [];
  let investorResponses: DealEngineDealDetail["investorResponses"] = [];
  let operatorTasks: DealEngineDealDetail["operatorTasks"] = [];
  let activityFeed: DealEngineDealDetail["activityFeed"] = [];
  let coordination = buildFallbackCoordination(lead, contractDraft);
  let packet = buildFallbackPacket(
    lead,
    contractDraft,
    relatedBuyerSignals.length ? relatedBuyerSignals : buyerSignals,
  );
  let room = buildFallbackRoom(lead, packet);

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const nexusContact = await findNexusContactForDeal(supabase, lead);
    sellerContact = mergeNexusContactProfile(sellerContact, nexusContact);
    sellerContactWorkflow = buildSellerContactWorkflow(lead, sellerContact);
    sellerOutreach = buildSellerOutreach(lead, sellerSignal, sellerContact, contractDraft);

    const { data } = await supabase
      .from("deal_packets")
      .select("property_notes,investor_summary,buyer_email_blast,buyer_sms_alert,contact_instructions,deadline_to_submit_offer,comps_placeholder")
      .eq("lead_id", dealId)
      .maybeSingle();
    const livePacket = data as DealPacketRow | null;
    if (livePacket) {
      packet = {
        propertyNotes: livePacket.property_notes ?? packet.propertyNotes,
        investorSummary: livePacket.investor_summary ?? packet.investorSummary,
        buyerEmailBlast: livePacket.buyer_email_blast ?? packet.buyerEmailBlast,
        buyerSmsAlert: livePacket.buyer_sms_alert ?? packet.buyerSmsAlert,
        contactInstructions: livePacket.contact_instructions ?? packet.contactInstructions,
        deadlineToSubmitOffer: livePacket.deadline_to_submit_offer ?? packet.deadlineToSubmitOffer,
        comps: livePacket.comps_placeholder?.length ? livePacket.comps_placeholder : packet.comps,
      };
      room = buildFallbackRoom(lead, packet);
    }

    const { data: contractData } = await supabase
      .from("contracts")
      .select("contract_sent,contract_signed,inspection_period,earnest_money_deposit,assignment_status")
      .eq("lead_id", dealId)
      .maybeSingle();
    const liveContract = contractData as ContractRow | null;
    if (liveContract) {
      coordination = {
        ...coordination,
        inspectionEndsOn: liveContract.inspection_period ?? coordination.inspectionEndsOn,
        buyerAssignmentStatus: liveContract.assignment_status ?? coordination.buyerAssignmentStatus,
        earnestMoneyStatus:
          liveContract.earnest_money_deposit != null
            ? `${formatCurrency(liveContract.earnest_money_deposit)} expected`
            : coordination.earnestMoneyStatus,
        contractSent: Boolean(liveContract.contract_sent),
        contractSigned: Boolean(liveContract.contract_signed),
      };
    }

    const { data: roomData } = await supabase
      .from("deal_rooms")
      .select("slug,property_summary,financial_breakdown,map_placeholder,comps_placeholder,downloadable_pdf_label,submit_interest_label,request_walkthrough_label")
      .eq("lead_id", dealId)
      .maybeSingle();
    const liveRoom = roomData as DealRoomRow | null;
    if (liveRoom) {
      room = {
        slug: liveRoom.slug ?? room.slug,
        propertySummary: liveRoom.property_summary ?? room.propertySummary,
        financialBreakdown: liveRoom.financial_breakdown?.length ? liveRoom.financial_breakdown : room.financialBreakdown,
        mapPlaceholder: liveRoom.map_placeholder ?? room.mapPlaceholder,
        compsPlaceholder: liveRoom.comps_placeholder?.length ? liveRoom.comps_placeholder : room.compsPlaceholder,
        downloadablePdfLabel: liveRoom.downloadable_pdf_label ?? room.downloadablePdfLabel,
        submitInterestLabel: liveRoom.submit_interest_label ?? room.submitInterestLabel,
        requestWalkthroughLabel: liveRoom.request_walkthrough_label ?? room.requestWalkthroughLabel,
      };
    }

    const { data: dispositionData } = await supabase
      .from("disposition_logs")
      .select("id,action_type,payload,created_at")
      .eq("lead_id", dealId)
      .in("action_type", ["investor_interest", "investor_follow_up", "stage_update", "contract_update", "packet_update", "buyer_draft_created", "seller_draft_saved", "operator_task", "coordination_update"])
      .order("created_at", { ascending: false });
    if (dispositionData?.length) {
      const logs = dispositionData as DispositionLogRow[];
      sellerDrafts = parseSellerDrafts(logs);
      investorResponses = parseDispositionLogs(logs);
      operatorTasks = parseOperatorTasks(logs);
      activityFeed = buildActivityFeed(logs);
      const latestCoordination = logs.find((log) => log.action_type === "coordination_update");
      if (latestCoordination?.payload) {
        const payload = latestCoordination.payload;
        coordination = {
          ...coordination,
          titleCompany: String(payload.titleCompany ?? coordination.titleCompany),
          titleOfficer: String(payload.titleOfficer ?? coordination.titleOfficer),
          walkthroughAt: String(payload.walkthroughAt ?? coordination.walkthroughAt),
          inspectionEndsOn: String(payload.inspectionEndsOn ?? coordination.inspectionEndsOn),
          closingDate: String(payload.closingDate ?? coordination.closingDate),
          buyerAssignmentStatus: String(payload.buyerAssignmentStatus ?? coordination.buyerAssignmentStatus),
          earnestMoneyStatus: String(payload.earnestMoneyStatus ?? coordination.earnestMoneyStatus),
          payoutStatus: String(payload.payoutStatus ?? coordination.payoutStatus),
          contractSent: Boolean(payload.contractSent ?? coordination.contractSent),
          contractSigned: Boolean(payload.contractSigned ?? coordination.contractSigned),
          coordinationNotes: String(payload.coordinationNotes ?? coordination.coordinationNotes),
          closingChecklist: normalizeChecklistItems(payload.closingChecklist, coordination.closingChecklist),
          closingDocuments: normalizeClosingDocuments(payload.closingDocuments, coordination.closingDocuments),
        };
      }
    }
  }

  if (!operatorTasks.some((task) => /seller phone|skip trace|first-touch/i.test(task.title))) {
    operatorTasks = [buildDefaultContactOperatorTask(lead, sellerContact), ...operatorTasks];
  }

  return {
    lead,
    sellerSignal,
    sellerContact,
    sellerContactWorkflow,
    sellerOutreach,
    buyerSignals: relatedBuyerSignals.length ? relatedBuyerSignals : buyerSignals.slice(0, 4),
    contractDraft,
    coordination,
    room,
    packet,
    sellerDrafts,
    relatedDrafts,
    investorResponses,
    operatorTasks,
    activityFeed,
  };
}

export async function getDealEngineDealRoomBySlug(slug: string) {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data } = await supabase
      .from("deal_rooms")
      .select("lead_id")
      .eq("slug", slug)
      .maybeSingle();
    const leadId = data && typeof data === "object" && "lead_id" in data ? String(data.lead_id) : null;
    if (leadId) {
      return getDealEngineDealDetail(leadId);
    }
  }

  // Workspace detail pages can expose a fallback room slug derived from the
  // property address even before a dedicated `deal_rooms` row exists. Resolve
  // those slugs here too so external room links never 404 during packet prep.
  const leads = await listDealEngineLeads(100);
  const matchedLead = leads.find((lead) => slugify(lead.propertyAddress) === slug);
  if (!matchedLead) return null;

  return getDealEngineDealDetail(matchedLead.id);
}

export async function getDealEngineWorkspaceSnapshot(): Promise<DealEngineWorkspaceSnapshot> {
  const env = getEnvState();
  const [leads, sellerSignals, buyerSignals] = await Promise.all([
    listDealEngineLeads(6),
    listDealEngineSellerSignals(4),
    listDealEngineBuyerSignals(4),
  ]);
  const usingFallback = !env.enabled || leads.every((lead) => fallbackLeads.some((item) => item.id === lead.id));
  const liveCount = leads.length;
  const offerReadyCount = leads.filter((lead) => lead.status === "Offer Ready").length;
  const negotiatingCount = leads.filter((lead) => lead.status === "Negotiating").length;

  return {
    env,
    usingFallback,
    leads,
    metrics: buildMetrics(leads),
    heroSignals: [
      env.enabled ? "Deal Engine live data path online" : `Awaiting ${env.missing.join(" + ")}`,
      usingFallback ? "workspace showing Helix fallback flagship deals" : `${liveCount} live deals in command`,
      offerReadyCount || negotiatingCount
        ? `${offerReadyCount} offer-ready / ${negotiatingCount} negotiating`
        : "analysis lane ready for first live handoff",
    ],
    stageBoard: buildStageBoard(leads),
    sellerSignals,
    buyerSignals,
    contractDrafts: buildContractDrafts(leads, sellerSignals, buyerSignals),
  };
}
