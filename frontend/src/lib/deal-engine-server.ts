import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import {
  type DealEngineBuyerSignal,
  type DealEngineContractDraft,
  type DealEngineLead,
  type DealEngineSellerSignal,
} from "@/lib/deal-engine";
import {
  CONTRACT_TEMPLATE_REGISTRY,
  isTemplateAllowedForGeneration,
  type ContractTemplateApprovalStatus,
  type ContractTemplateLicenseStatus,
  type ContractTemplateRecord,
  type ContractTemplateType,
} from "@/lib/contract-template-registry";
import type { SellerLeadView } from "@/lib/seller-engine-demo";
import { listSellerLeads, updateSellerLead } from "@/lib/seller-engine-server";
import {
  createSearchJob,
  listAllBuyerReports,
  listOutreachDraftRecords,
  persistOutreachDraftRecord,
  listSearchJobsByIds,
  type BuyerReportRecord,
  type SearchJobRecord,
} from "@/lib/buyer-engine-server";
import type { OutreachDraftRecord } from "@/lib/outreach-drafts";
import { getCountyLaunchBlock } from "@/lib/buyer-engine-data";
import { isResendConfigured, sendReconEmail } from "@/lib/recon-engine/email";

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

type NexusContactNotePayload = {
  source_lead_id?: string | null;
  owner_name?: string | null;
  property_address?: string | null;
  mailing_address?: string | null;
  primary_phone?: string | null;
  primary_email?: string | null;
  contact_confidence_score?: number | null;
  provider?: string | null;
  status?: string | null;
  completed_at?: string | null;
};

type SellerLeadContactLookupRow = {
  id: string;
  owners: { name: string | null; mailing_address: string | null } | null;
  properties: { property_address: string | null; city: string | null; state: string | null; zip_code: string | null } | null;
};

export type DealEngineMetric = {
  label: string;
  value: string;
  detail: string;
};

export type DealEngineWorkspaceSnapshot = {
  env: EnvState;
  persistence: {
    ready: boolean;
    mode: "live" | "schema-missing" | "env-missing";
    detail: string;
  };
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
  underwriting: {
    estimatedArv: number;
    sellerAskingPrice: number;
    repairEstimate: number;
    closingCosts: number;
    holdingCosts: number;
    buyerProfitTarget: number;
    assignmentFeeTarget: number;
    rentalEstimate: number;
    flipEstimate: number;
    purchasePriceTarget: number;
    maximumAllowableOffer: number;
    wholesaleSpread: number;
    dealRating: string;
    missingInputs: string[];
    readyForContract: boolean;
    compliance: {
      strategy: string;
      disclosureHeadline: string;
      licenseNote: string;
      marketingRule: string;
      earnestMoneyRule: string;
      cancellationRule: string;
      contractWarnings: string[];
      checklist: string[];
    };
  };
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
  outreachExecutions: Array<{
    id: string;
    audience: string;
    channel: string;
    recipient: string;
    status: string;
    outcome: string;
    nextStep: string;
    notes: string;
    loggedAt: string;
  }>;
  uploadedDocuments: Array<{
    id: string;
    category: string;
    name: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    owner: string;
    status: string;
    notes: string;
    source: string;
    uploadedAt: string;
    storagePath: string;
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
  closeout: {
    outcome: string;
    closedAt: string;
    assignmentFeeCollected: number;
    buyerName: string;
    notes: string;
    recordedAt: string;
  } | null;
  automationWorkflow: Array<{
    id: string;
    title: string;
    detail: string;
    status: "ready" | "active" | "blocked";
  }>;
};

export type DealCommanderInsight = {
  priority: "High" | "Medium" | "Low";
  confidenceScore: number;
  suggestedNextAction: string;
  estimatedMao: number;
  offerRangeLow: number;
  offerRangeHigh: number;
  negotiationAngle: string;
  sellerPainPointHypothesis: string;
  buyerFitSummary: string;
  riskWarnings: string[];
  dispositionStrategy: string;
  followUpRecommendation: string;
  generationMode: "rules" | "ai";
  generatedAt: string;
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

type DealAnalysisRow = {
  estimated_arv: number | null;
  purchase_price_target: number | null;
  seller_asking_price: number | null;
  repair_estimate: number | null;
  closing_costs: number | null;
  holding_costs: number | null;
  buyer_profit_target: number | null;
  assignment_fee_target: number | null;
  rental_estimate: number | null;
  flip_estimate: number | null;
  wholesale_spread: number | null;
  maximum_allowable_offer: number | null;
  deal_rating: string | null;
};

type DealContractDraftRow = {
  id: string;
  draft_type: string;
  title: string;
  body: string;
  special_terms: string | null;
  template_id?: string | null;
  template_type?: string | null;
  status?: string | null;
  generated_body?: string | null;
  generated_pdf_url?: string | null;
  editable_payload?: Record<string, unknown> | null;
  legal_disclaimer_acknowledged?: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ContractTemplateRow = {
  id: string;
  template_key: string;
  template_type: string;
  name: string;
  intended_purpose: string;
  source_name: string;
  source_url: string;
  license_status: string;
  approval_status: string;
  state: string | null;
  version: string;
  required_fields: string[] | null;
  optional_fields: string[] | null;
  variable_map: Record<string, string> | null;
  storage_path: string | null;
  notes: string | null;
};

type DealSignaturePacketRow = {
  id: string;
  signature_status: string | null;
  sent_for_signature_at: string | null;
  signed_by_seller_at: string | null;
  signed_by_buyer_at: string | null;
  signature_provider: string | null;
  signature_packet_url: string | null;
  signer_email: string | null;
  signer_role: string | null;
  metadata: Record<string, unknown> | null;
};

type DealTitleChecklistItemRow = {
  id: string;
  item_key: string;
  label: string;
  status: string | null;
  notes: string | null;
  due_date: string | null;
  assigned_owner: string | null;
  updated_at: string;
};

type DealEmdTrackerRow = {
  id: string;
  emd_amount: number | null;
  emd_due_date: string | null;
  emd_holder: string | null;
  emd_holder_type: string | null;
  emd_status: string | null;
  emd_payment_method: string | null;
  emd_receipt_url: string | null;
  emd_notes: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

type DealAssignmentFeeTrackerRow = {
  id: string;
  seller_contract_price: number | null;
  buyer_assignment_price: number | null;
  assignment_fee: number | null;
  expected_net_fee: number | null;
  title_company_fee: number | null;
  other_closing_costs: number | null;
  payout_status: string | null;
  payout_due_date: string | null;
  payout_received_at: string | null;
  payout_notes: string | null;
  updated_at: string;
};

type DealClosingTimelineEventRow = {
  id: string;
  event_type: string;
  label: string;
  status: string | null;
  due_date: string | null;
  completed_at: string | null;
  notes: string | null;
  updated_at: string;
};

type DealDocumentVaultRow = {
  id: string;
  document_id: string;
  file_name: string;
  file_type: string | null;
  category: string;
  uploaded_by: string | null;
  uploaded_at: string;
  document_url: string | null;
  storage_path: string | null;
  notes: string | null;
  linked_item_type: string | null;
  linked_item_id: string | null;
  updated_at: string;
};

export type DealContractDraftRecord = {
  id: string;
  draftType: string;
  templateId: string | null;
  templateType: string;
  status: string;
  title: string;
  body: string;
  specialTerms: string;
  generatedPdfUrl: string;
  editablePayload: Record<string, unknown>;
  legalDisclaimerAcknowledged: boolean;
  updatedAt: string;
};

export type DealContractTemplateRecord = {
  id: string;
  templateKey: string;
  type: string;
  name: string;
  intendedPurpose: string;
  sourceName: string;
  sourceUrl: string;
  licenseStatus: ContractTemplateLicenseStatus;
  approvalStatus: ContractTemplateApprovalStatus;
  state: string | null;
  version: string;
  requiredFields: string[];
  optionalFields: string[];
  variableMap: Record<string, string>;
  storagePath: string | null;
  notes: string;
  requestedUse: string;
};

export type DealContractTemplateValidation = {
  template: DealContractTemplateRecord;
  requestedUse: string;
  purposeValid: boolean;
  blockingError: string | null;
  missingFields: string[];
  availableFields: Record<string, string>;
  disclaimerRequired: boolean;
  canGenerate: boolean;
};

export type DealSignaturePacketRecord = {
  id: string | null;
  signatureStatus: string;
  sentForSignatureAt: string | null;
  signedBySellerAt: string | null;
  signedByBuyerAt: string | null;
  signatureProvider: string;
  signaturePacketUrl: string;
  signerEmail: string;
  signerRole: string;
  availableProviders: string[];
};

export type DealTitleChecklistItemRecord = {
  id: string;
  itemKey: string;
  label: string;
  status: "pending" | "complete" | "blocked";
  notes: string;
  dueDate: string;
  assignedOwner: string;
  updatedAt: string;
};

export type DealEmdTrackerRecord = {
  id: string | null;
  emdAmount: number;
  emdDueDate: string;
  emdHolder: string;
  emdHolderType: "title_company" | "attorney" | "broker" | "other";
  emdStatus: "not_required" | "pending" | "submitted" | "received" | "overdue" | "released" | "forfeited";
  emdPaymentMethod: string;
  emdReceiptUrl: string;
  emdNotes: string;
  alertFlags: string[];
  statusTone: "good" | "warn" | "bad" | "neutral";
};

export type DealAssignmentFeeTrackerRecord = {
  id: string | null;
  sellerContractPrice: number;
  buyerAssignmentPrice: number;
  assignmentFee: number;
  expectedNetFee: number;
  titleCompanyFee: number;
  otherClosingCosts: number;
  payoutStatus: "projected" | "pending_closing" | "confirmed" | "paid" | "delayed";
  payoutDueDate: string;
  payoutReceivedAt: string;
  payoutNotes: string;
  closingWarning: string | null;
};

export type DealClosingTimelineEventRecord = {
  id: string;
  eventType: string;
  label: string;
  status: "upcoming" | "complete" | "delayed" | "blocked";
  dueDate: string;
  completedAt: string;
  notes: string;
  updatedAt: string;
};

export type DealDocumentVaultRecord = {
  id: string;
  documentId: string;
  fileName: string;
  fileType: string;
  category: string;
  uploadedBy: string;
  uploadedAt: string;
  documentUrl: string;
  notes: string;
  linkedItemType: string;
  linkedItemId: string;
};

export type DealTransactionCenterSnapshot = {
  contractTemplates: DealContractTemplateRecord[];
  contracts: DealContractDraftRecord[];
  signaturePacket: DealSignaturePacketRecord;
  titleChecklist: DealTitleChecklistItemRecord[];
  emdTracker: DealEmdTrackerRecord;
  assignmentTracker: DealAssignmentFeeTrackerRecord;
  timeline: DealClosingTimelineEventRecord[];
  documents: DealDocumentVaultRecord[];
};

type RankedBuyerSignal = DealEngineBuyerSignal & {
  matchScore: number;
  matchReason: string;
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

function clampMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(Math.round(value), 0);
}

function toIsoDateString(value: Date) {
  return value.toISOString().slice(0, 10);
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
  if (!leads.length) {
    return [
      {
        label: "Qualified Leads In Command",
        value: "00",
        detail: "No live Deal Engine records are stored yet.",
      },
      {
        label: "Offers Ready",
        value: "00",
        detail: "No live deals are currently in offer-ready status.",
      },
      {
        label: "Negotiating",
        value: "00",
        detail: "No live acquisition conversations are active right now.",
      },
      {
        label: "Projected Assignment Fees",
        value: formatCurrency(0),
        detail: "Projected fee volume will populate from live deal records only.",
      },
    ] satisfies DealEngineMetric[];
  }

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

function toDealLeadFromSellerHandoff(lead: SellerLeadView): DealEngineLead {
  const maoBase = lead.estimatedEquity || lead.assessedValue || 0;
  const mao = maoBase ? Math.round(maoBase * 0.72) : 0;
  const assignmentFee = lead.score >= 80 ? 18000 : lead.score >= 65 ? 12000 : 7500;

  return {
    id: lead.id,
    ownerName: lead.ownerName,
    ownerPhone: lead.ownerPhone,
    phoneStatus: lead.phoneStatus,
    skipTraceStatus: lead.skipTraceStatus,
    phoneSource: lead.phoneSource,
    contactEnrichmentNotes: lead.contactEnrichmentNotes,
    propertyAddress: [lead.propertyAddress, [lead.city, lead.state, lead.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    county: lead.county,
    status: lead.status,
    motivationScore: lead.score,
    mao: mao ? formatCurrency(mao) : "TBD",
    assignmentFee: formatCurrency(assignmentFee),
    exitStrategy: lead.propertyType && /duplex|multi/i.test(lead.propertyType)
      ? "Rental buyer or BRRRR disposition lane"
      : "Wholesale to local investor buyer pool",
    nextAction: lead.recommendedAction,
  };
}

function isMissingDealTableError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  return error.code === "PGRST205" || /deal_leads|seller_conversations|buyer_matches|deal_analysis|contracts|deal_packets|deal_rooms|disposition_logs/i.test(error.message ?? "");
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

function normalizeBuyerSignalLane(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "unknown" || normalized === "all") return "general";
  if (/land|lot|acre/.test(normalized)) return "land";
  if (/duplex|triplex|quad|multi|apartment/.test(normalized)) return "multifamily";
  if (/commercial|retail|office|industrial/.test(normalized)) return "commercial";
  return "residential";
}

function normalizeDealLane(lead: DealEngineLead) {
  const normalized = `${lead.exitStrategy} ${lead.propertyAddress}`.toLowerCase();
  if (/land|lot|acre/.test(normalized)) return "land";
  if (/brrrr|duplex|triplex|quad|multi|rental/.test(normalized)) return "multifamily";
  if (/commercial|retail|office|industrial/.test(normalized)) return "commercial";
  return "residential";
}

function rankBuyerSignalsForLead(
  lead: DealEngineLead,
  buyerSignals: DealEngineBuyerSignal[],
  limit = 4,
): RankedBuyerSignal[] {
  const dealLane = normalizeDealLane(lead);
  const countyNeedle = lead.county.trim().toLowerCase();

  return buyerSignals
    .map((signal) => {
      const market = signal.market.toLowerCase();
      const countyMatch = countyNeedle.length > 0 && market.includes(countyNeedle);
      const stateMatch = /\bnc\b/.test(market);
      const buyerLane = normalizeBuyerSignalLane(signal.propertyType);
      const laneMatch =
        buyerLane === "general"
        || (dealLane === "residential" && buyerLane !== "land" && buyerLane !== "commercial")
        || buyerLane === dealLane;

      const matchScore =
        signal.score
        + (countyMatch ? 45 : stateMatch ? 18 : 0)
        + (laneMatch ? 12 : 0)
        + Math.min(signal.purchaseCount * 4, 20)
        + (/llc|holdings|capital|partners|properties|trust/i.test(signal.buyerName) ? 6 : 0);

      const matchReason = countyMatch
        ? `Active ${lead.county} lane with a ${signal.propertyType.toLowerCase()} search profile.`
        : stateMatch
          ? `Strong North Carolina buyer signal while ${lead.county}-specific buyer inventory is still building.`
          : "Fallback buyer lane from the broader live Buyer Engine inventory.";

      return {
        ...signal,
        matchScore,
        matchReason,
      };
    })
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      if (right.score !== left.score) return right.score - left.score;
      return right.purchaseCount - left.purchaseCount;
    })
    .filter((signal, index, collection) => (
      collection.findIndex((candidate) => candidate.buyerName === signal.buyerName && candidate.market === signal.market) === index
    ))
    .slice(0, limit);
}

function buildInvestorTypeRecommendation(
  lead: DealEngineLead,
  buyerSignals: RankedBuyerSignal[],
) {
  const topBuyer = buyerSignals[0];
  if (!topBuyer) {
    return `No live buyer shortlist is attached yet. Run Buyer Engine for ${lead.county} County and attach the first active buyer cohort.`;
  }

  if (topBuyer.market.toLowerCase().includes(lead.county.toLowerCase())) {
    return `${topBuyer.buyerName} leads the live buyer lane for this ${lead.county} County deal.`;
  }

  return `${topBuyer.buyerName} is the strongest live statewide fallback until a ${lead.county} County buyer search finishes.`;
}

function deriveOfferWindow(mao: string, assignmentFee: string) {
  const maoValue = Number(mao.replace(/[^0-9.-]/g, ""));
  const assignmentValue = Number(assignmentFee.replace(/[^0-9.-]/g, ""));
  const low = Number.isFinite(maoValue) ? Math.max(maoValue - Math.max(assignmentValue / 2, 5000), 0) : 0;
  const high = Number.isFinite(maoValue) ? maoValue : 0;
  return `${formatCurrency(low)} - ${formatCurrency(high)}`;
}

function deriveOfferWindowFromNumbers(maximumAllowableOffer: number, assignmentFeeTarget: number) {
  const high = clampMoney(maximumAllowableOffer);
  const low = high > 0 ? Math.max(high - Math.max(clampMoney(assignmentFeeTarget) / 2, 5000), 0) : 0;
  return `${formatCurrency(low)} - ${formatCurrency(high)}`;
}

function estimateArvFromSignals(input: {
  assessedValue: number;
  county: string;
  propertyType: string;
  hasVacancy: boolean;
  hasCodeViolation: boolean;
  hasTaxPressure: boolean;
  hasForeclosure: boolean;
  hasProbate: boolean;
  valueSource?: "deal" | "linked-property" | "seller-lead" | "market-median";
}) {
  const countyKey = input.county.trim().toLowerCase();
  const propertyType = input.propertyType.trim().toLowerCase();

  const countyMultiplierMap: Record<string, number> = {
    mecklenburg: 1.18,
    wake: 1.17,
    durham: 1.16,
    guilford: 1.14,
    forsyth: 1.14,
    cumberland: 1.13,
  };

  let multiplier = countyMultiplierMap[countyKey] ?? 1.15;

  if (/duplex|triplex|quad|small multifamily|multi/i.test(propertyType)) multiplier += 0.04;
  else if (/townhome|condo/i.test(propertyType)) multiplier += 0.02;
  else if (/land|lot|acre/i.test(propertyType)) multiplier -= 0.08;

  if (input.hasVacancy) multiplier += 0.02;
  if (input.hasCodeViolation) multiplier += 0.02;
  if (input.hasTaxPressure || input.hasForeclosure || input.hasProbate) multiplier += 0.01;

  multiplier = Math.min(Math.max(multiplier, 1.05), 1.28);

  const estimatedArv = clampMoney(input.assessedValue * multiplier);
  const rangeWidth = countyMultiplierMap[countyKey] ? 0.04 : 0.06;
  const rangeLow = clampMoney(estimatedArv * (1 - rangeWidth));
  const rangeHigh = clampMoney(estimatedArv * (1 + rangeWidth));
  const confidence =
    input.assessedValue > 0
      ? input.valueSource === "market-median"
        ? countyMultiplierMap[countyKey]
          ? "low-medium"
          : "low"
        : countyMultiplierMap[countyKey]
          ? "medium"
          : "medium-low"
      : "low";

  const sourceLabelMap: Record<NonNullable<typeof input.valueSource>, string> = {
    deal: "deal record assessed value",
    "linked-property": "linked property assessed value",
    "seller-lead": "seller lead assessed value",
    "market-median": "same-market median assessed value",
  };
  const sourceLabel = input.valueSource ? sourceLabelMap[input.valueSource] : "assessed value";

  return {
    estimatedArv,
    rangeLow,
    rangeHigh,
    confidence,
    basis: `${sourceLabel} ${formatCurrency(input.assessedValue)} x multiplier ${multiplier.toFixed(2)} using ${input.county} County, ${input.propertyType}, and distress signals.`,
  };
}

function normalizeValuationPropertyType(propertyType: string) {
  const normalized = propertyType.trim().toLowerCase();
  if (!normalized || /foreclosure|probate|distress|unknown/.test(normalized)) return "single-family";
  if (/townhome|condo/.test(normalized)) return "condo-townhome";
  if (/duplex|triplex|quad|multi/.test(normalized)) return "multifamily";
  if (/commercial|retail|office|industrial/.test(normalized)) return "commercial";
  if (/land|lot|acre/.test(normalized)) return "land";
  return "single-family";
}

function propertyMatchesValuationBucket(propertyType: string | null, valuationBucket: string) {
  const normalized = normalizeValuationPropertyType(propertyType ?? "");
  return normalized === valuationBucket;
}

async function findMarketMedianAssessedValue(input: {
  supabase: SupabaseClient;
  county: string;
  city: string;
  propertyType: string;
}) {
  const city = input.city.trim();
  const county = input.county.trim();
  const valuationBucket = normalizeValuationPropertyType(input.propertyType);

  const loadCandidates = async (matchCity: boolean) => {
    let query = input.supabase
      .from("properties")
      .select("property_type,assessed_value,city,county")
      .eq("county", county)
      .not("assessed_value", "is", null)
      .limit(matchCity ? 400 : 800);

    if (matchCity) {
      query = query.eq("city", city);
    }

    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).filter((row) =>
      Number(row.assessed_value) > 0 && propertyMatchesValuationBucket(row.property_type, valuationBucket),
    );
  };

  const cityCandidates = city ? await loadCandidates(true) : [];
  const countyCandidates = cityCandidates.length >= 8 ? cityCandidates : await loadCandidates(false);
  const values = countyCandidates
    .map((row) => clampMoney(Number(row.assessed_value ?? 0)))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (!values.length) return null;

  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? clampMoney((values[middle - 1] + values[middle]) / 2)
    : values[middle];

  return {
    assessedValue: median,
    sampleCount: values.length,
    scope: cityCandidates.length >= 8 ? "city" as const : "county" as const,
    valuationBucket,
  };
}

function buildContractDrafts(
  leads: DealEngineLead[],
  sellerSignals: DealEngineSellerSignal[],
  buyerSignals: DealEngineBuyerSignal[],
) {
  if (!leads.length) return [];

  return leads.map((lead) => {
    const sellerSignal = findSellerSignalForLead(lead, sellerSignals);
    const buyerSignal = rankBuyerSignalsForLead(lead, buyerSignals, 1)[0] ?? null;

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

async function getDealEnginePersistenceStatus() {
  const env = getEnvState();
  if (!env.enabled) {
    return {
      ready: false,
      mode: "env-missing" as const,
      detail: `Missing env: ${env.missing.join(", ")}`,
    };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ready: false,
      mode: "env-missing" as const,
      detail: `Missing env: ${env.missing.join(", ")}`,
    };
  }

  const { error } = await supabase
    .from("deal_leads")
    .select("id")
    .limit(1);

  if (isMissingDealTableError(error)) {
    return {
      ready: false,
      mode: "schema-missing" as const,
      detail: "Deal Engine migration is not applied yet. Live persistence tables are missing.",
    };
  }

  return {
    ready: true,
    mode: "live" as const,
    detail: "Deal Engine persistence tables are available for live reads and writes.",
  };
}

export async function listDealEngineLeads(limit = 6): Promise<DealEngineLead[]> {
  const supabase = getSupabaseAdmin();
  const sellerHandoffFallback = async () => {
    const sellerLeads = await listSellerLeads().catch(() => []);
    return sellerLeads
      .filter((lead) => lead.status === "Sent to Deal Engine")
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(toDealLeadFromSellerHandoff);
  };
  if (!supabase) return sellerHandoffFallback();

  const { data, error } = await supabase
    .from("deal_leads")
    .select(
      "id,owner_name,property_address,county,status,motivation_score,recommended_next_action,deal_analysis(maximum_allowable_offer,assignment_fee_target),seller_conversations(next_action),buyer_matches(exit_strategy)",
    )
    .order("motivation_score", { ascending: false })
    .limit(limit);

  if (isMissingDealTableError(error)) return sellerHandoffFallback();
  if (error || !data?.length) return [];
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
    return prioritized;
  } catch {
    return [];
  }
}

export async function listDealEngineBuyerSignals(limit = 4): Promise<DealEngineBuyerSignal[]> {
  const env = getEnvState();
  if (!env.enabled) return [];

  try {
    const reportPage = await listAllBuyerReports({ limit: Math.max(limit * 3, 12), offset: 0 });
    if (!reportPage.reports.length) return [];

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

    return signals;
  } catch {
    return [];
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

type SaveDealAnalysisInput = {
  dealId: string;
  estimatedArv: number;
  sellerAskingPrice: number;
  repairEstimate: number;
  closingCosts: number;
  holdingCosts: number;
  buyerProfitTarget: number;
  assignmentFeeTarget: number;
  rentalEstimate: number;
  flipEstimate: number;
};

type EstimateDealArvInput = {
  dealId: string;
};

type LaunchBuyerSearchFromDealInput = {
  dealId: string;
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
  slug?: string;
  dealId?: string;
  investorName: string;
  investorEmail: string;
  interestType: string;
  notes: string;
  preferredWalkthroughAt: string;
  attendeeCount: string;
  proofOfFundsStatus: string;
};

type UploadDealDocumentInput = {
  dealId: string;
  category: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  owner: string;
  status: string;
  notes: string;
  source: string;
};

type SendDealEmailInput = {
  dealId: string;
  to: string;
  subject: string;
  body: string;
  audience: string;
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

type SaveDealOutreachExecutionInput = {
  dealId: string;
  audience: string;
  channel: string;
  recipient: string;
  status: string;
  outcome: string;
  nextStep: string;
  notes: string;
};

type SaveDealCloseoutInput = {
  dealId: string;
  outcome: string;
  closedAt: string;
  assignmentFeeCollected: number;
  buyerName: string;
  notes: string;
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
  const propertyLabel = input.propertyType.replace(/_/g, " ").toLowerCase();
  const activityLine =
    input.purchaseCount > 1
      ? `I noticed you've been active in ${input.market}, with around ${input.purchaseCount} recent purchases showing up on our side.`
      : `I noticed you've been active in ${input.market}, so I wanted to reach out directly.`;

  return [
    `Hi ${input.buyerName},`,
    "",
    `I wanted to reach out because we have a ${propertyLabel} opportunity at ${input.propertyAddress}.`,
    activityLine,
    `From what we can tell, you've deployed about ${input.totalSpend} in this lane, so this felt worth putting in front of you.`,
    "",
    "If you're still buying in this part of the market, I can send the packet and the basic numbers over.",
    "",
    "Carlos",
    "Blackspire Helix Group",
  ].join("\n");
}

function buildUnderwritingSnapshot(
  lead: DealEngineLead,
  analysis: DealAnalysisRow | null,
) {
  const estimatedArv = clampMoney(analysis?.estimated_arv ?? 0);
  const repairEstimate = clampMoney(analysis?.repair_estimate ?? 0);
  const closingCosts = clampMoney(analysis?.closing_costs ?? 0);
  const holdingCosts = clampMoney(analysis?.holding_costs ?? 0);
  const buyerProfitTarget = clampMoney(analysis?.buyer_profit_target ?? 0);
  const assignmentFeeTarget = clampMoney(analysis?.assignment_fee_target ?? Number(lead.assignmentFee.replace(/[^0-9.-]/g, "")));
  const sellerAskingPrice = clampMoney(analysis?.seller_asking_price ?? 0);
  const rentalEstimate = clampMoney(analysis?.rental_estimate ?? 0);
  const flipEstimate = clampMoney(analysis?.flip_estimate ?? 0);
  const maximumAllowableOffer = clampMoney(
    analysis?.maximum_allowable_offer
    ?? (estimatedArv - repairEstimate - closingCosts - holdingCosts - buyerProfitTarget - assignmentFeeTarget),
  );
  const purchasePriceTarget = clampMoney(analysis?.purchase_price_target ?? maximumAllowableOffer);
  const wholesaleSpread = clampMoney(analysis?.wholesale_spread ?? Math.max(estimatedArv - purchasePriceTarget - repairEstimate - closingCosts - holdingCosts, 0));

  const missingInputs = [
    estimatedArv <= 0 ? "Set ARV / resale value" : null,
    repairEstimate <= 0 ? "Set repair estimate" : null,
    sellerAskingPrice <= 0 ? "Capture seller asking price or expected anchor" : null,
  ].filter((item): item is string => Boolean(item));

  const dealRating =
    analysis?.deal_rating
    ?? (missingInputs.length
      ? "Needs Underwriting"
      : maximumAllowableOffer > 0 && wholesaleSpread >= assignmentFeeTarget
        ? "Green Deal"
        : "Yellow Deal");

  const readyForContract = missingInputs.length === 0 && maximumAllowableOffer > 0;
  const compliance = buildWholesalingComplianceSnapshot(lead.exitStrategy);

  return {
    estimatedArv,
    sellerAskingPrice,
    repairEstimate,
    closingCosts,
    holdingCosts,
    buyerProfitTarget,
    assignmentFeeTarget,
    rentalEstimate,
    flipEstimate,
    purchasePriceTarget,
    maximumAllowableOffer,
    wholesaleSpread,
    dealRating,
    missingInputs,
    readyForContract,
    compliance,
  };
}

function buildWholesalingComplianceSnapshot(exitStrategy: string) {
  return {
    strategy: /assign/i.test(exitStrategy)
      ? "Assignment-first wholesale posture"
      : "Wholesale deal requiring assignment/direct-close review",
    disclosureHeadline: "Use a written equitable-interest disclosure in the seller-facing contract lane.",
    licenseNote: "Check current state wholesaling license or registration rules before repeated assignment activity.",
    marketingRule: "Do not advertise the property as if Blackspire owns it; market the contract or equitable interest only.",
    earnestMoneyRule: "Keep earnest money with title or escrow and define how deposit credit/replacement works after assignment.",
    cancellationRule: "Confirm whether the state requires a seller rescission or cancellation notice before sending the agreement.",
    contractWarnings: [
      "Disclose that Blackspire is selling or assigning equitable interest, not marketing as the property owner.",
      "Verify the purchase agreement expressly permits assignment or use a compliant direct-close structure before outreach.",
      "Confirm state-specific seller disclosure and cancellation language before sending any agreement for signature.",
    ],
    checklist: [
      "Give a clear written wholesaler disclosure to the seller before contract execution.",
      "Market only the contract or equitable interest, not the property as if Blackspire owns it.",
      "Keep earnest money instructions tied to title or escrow and document how deposits move after assignment.",
      "Verify whether the state requires licensing, registration, or rescission language for this wholesale structure.",
      "Have the final purchase agreement reviewed against current state law before signature.",
    ],
  };
}

function buildDealAutomationWorkflow(
  detail: Pick<DealEngineDealDetail, "underwriting" | "sellerContact" | "buyerSignals" | "coordination" | "packet" | "lead" | "uploadedDocuments">,
): DealEngineDealDetail["automationWorkflow"] {
  const hasSellerPhone = detail.sellerContact.ownerPhone !== "Not captured";
  const underwritingReady = detail.underwriting.readyForContract;
  const buyerReady = detail.buyerSignals.length > 0;
  const packetReady = Boolean(detail.packet.investorSummary.trim() && detail.packet.buyerEmailBlast.trim());
  const contractReady = detail.coordination.contractSent && detail.coordination.contractSigned;
  const documentReady = detail.uploadedDocuments.some((item) =>
    /signed contract|assignment agreement|proof of funds|settlement statement|closing disclosure/i.test(item.category),
  );
  const emailReady = isResendConfigured();

  return [
    {
      id: `${detail.lead.id}-workflow-contact`,
      title: "Verify seller contact and compliance lane",
      detail: hasSellerPhone
        ? "Primary seller phone is present. Confirm compliance posture and first-touch channel."
        : "No verified seller phone is attached yet. Run Nexus / skip trace before outreach.",
      status: hasSellerPhone ? "ready" : "blocked",
    },
    {
      id: `${detail.lead.id}-workflow-underwrite`,
      title: "Complete underwriting inputs",
      detail: underwritingReady
        ? `Underwriting is live. MAO is ${formatCurrency(detail.underwriting.maximumAllowableOffer)} with rating ${detail.underwriting.dealRating}. Compliance lane: ${detail.underwriting.compliance.disclosureHeadline}`
        : `Still missing: ${detail.underwriting.missingInputs.join("; ")}.`,
      status: underwritingReady ? "ready" : "active",
    },
    {
      id: `${detail.lead.id}-workflow-contract`,
      title: "Save contract posture and send agreement",
      detail: contractReady
        ? "Contract has been sent and signed. Keep title and assignment moving."
        : detail.coordination.contractSent
          ? "Contract is marked sent. Next move is signature collection and title cadence."
          : `Use the contract console after underwriting is complete to set pricing, earnest money, and seller disclosure language.`,
      status: underwritingReady ? (contractReady ? "ready" : "active") : "blocked",
    },
    {
      id: `${detail.lead.id}-workflow-buyers`,
      title: "Refresh buyer shortlist and outreach drafts",
      detail: buyerReady
        ? `${detail.buyerSignals.length} live buyer matches are attached. Generate drafts and pressure-test fit.`
        : "No buyer matches are attached yet. Run Buyer Engine search for this county and lane.",
      status: buyerReady ? "ready" : "active",
    },
    {
      id: `${detail.lead.id}-workflow-packet`,
      title: "Finalize buyer packet and room",
      detail: packetReady
        ? "Packet copy is present. Save the packet and release the deal room when ready."
        : "Investor summary and buyer-facing copy still need to be finalized.",
      status: contractReady ? (packetReady ? "ready" : "active") : "blocked",
    },
    {
      id: `${detail.lead.id}-workflow-documents`,
      title: "Collect signed files and close-table docs",
      detail: documentReady
        ? `${detail.uploadedDocuments.length} uploaded deal file(s) are attached to this close lane.`
        : "Upload signed contracts, proof of funds, and title/settlement files onto the deal.",
      status: documentReady ? "ready" : contractReady ? "active" : "blocked",
    },
    {
      id: `${detail.lead.id}-workflow-email`,
      title: "Use in-app email delivery where available",
      detail: emailReady
        ? "Resend-backed email sending is configured for seller or buyer email from the workstation."
        : "Email console is built, but live sending still needs RESEND_API_KEY configured.",
      status: emailReady ? "ready" : "blocked",
    },
  ];
}

function mergeUploadedDocumentsIntoCoordination(
  coordination: DealEngineDealDetail["coordination"],
  uploadedDocuments: DealEngineDealDetail["uploadedDocuments"],
) {
  if (!uploadedDocuments.length) return coordination;

  const merged = [...coordination.closingDocuments];
  uploadedDocuments.forEach((document) => {
    if (merged.some((item) => item.name === document.fileName || item.name === document.category)) return;
    merged.unshift({
      id: document.id,
      name: document.category,
      status: document.status,
      owner: document.owner,
      notes: document.notes || document.fileName,
    });
  });

  return {
    ...coordination,
    closingDocuments: merged.slice(0, 20),
  };
}

function buildFallbackPacket(
  lead: DealEngineLead,
  contractDraft: DealEngineContractDraft | null,
  buyerSignals: DealEngineBuyerSignal[],
): DealEngineDealDetail["packet"] {
  const buyerSignal = rankBuyerSignalsForLead(lead, buyerSignals, 1)[0] ?? null;
  return {
    propertyNotes: `${lead.propertyAddress} is being staged inside Blackspire Deal Engine. Validate scope, condition, access, and clean-close positioning before broad buyer release.`,
    investorSummary: contractDraft?.buyerDispositionNote ?? "Investor summary still being assembled.",
    buyerEmailBlast: buyerSignal
      ? `Blackspire has a ${lead.county} opportunity at ${lead.propertyAddress} aligned to buyers like ${buyerSignal.buyerName}. Packet available on request after operator review.`
      : `Blackspire has a ${lead.county} opportunity currently moving through underwriting.`,
    buyerSmsAlert: `${lead.county} deal lane active. ${lead.propertyAddress}. Reply for packet access through Blackspire Deal Engine.`,
    contactInstructions: "Coordinate all buyer questions and walkthrough requests through Blackspire Deal Engine.",
    deadlineToSubmitOffer: "TBD",
    comps: [],
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

function normalizeAddressMatch(value: string) {
  return normalizeContactMatch(value)
    .replace(/[.,#]/g, "")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\s+/g, " ")
    .trim();
}

function addressesLikelyMatch(left: string, right: string) {
  const normalizedLeft = normalizeAddressMatch(left);
  const normalizedRight = normalizeAddressMatch(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
  );
}

function findSellerSignalForLead(
  lead: DealEngineLead,
  sellerSignals: DealEngineSellerSignal[],
): DealEngineSellerSignal | null {
  return sellerSignals.find((item) => addressesLikelyMatch(item.propertyAddress, lead.propertyAddress)) ?? null;
}

function formatSellerPropertyAddress(property: SellerLeadContactLookupRow["properties"]) {
  if (!property?.property_address) return "";
  const cityStateZip = [property.city, property.state, property.zip_code].filter(Boolean).join(" ");
  return [property.property_address, cityStateZip].filter(Boolean).join(", ");
}

function parseNexusContactNote(note: string): NexusContactNotePayload | null {
  const prefix = "NEXUS_CONTACT_RESULT ";
  if (!note.startsWith(prefix)) return null;
  try {
    const payload = JSON.parse(note.slice(prefix.length)) as NexusContactNotePayload;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function nexusPayloadToContactRow(
  payload: NexusContactNotePayload,
  lead: DealEngineLead,
  sellerLead?: SellerLeadContactLookupRow | null,
): NexusContactRow {
  return {
    owner_name: payload.owner_name?.trim() || sellerLead?.owners?.name?.trim() || lead.ownerName,
    property_address: payload.property_address?.trim() || formatSellerPropertyAddress(sellerLead?.properties ?? null) || lead.propertyAddress,
    mailing_address: payload.mailing_address?.trim() || sellerLead?.owners?.mailing_address || null,
    primary_phone: payload.primary_phone?.trim() || null,
    primary_email: payload.primary_email?.trim() || null,
    contact_confidence_score: payload.contact_confidence_score ?? null,
    provider: payload.provider?.trim() || "Tracerfy",
    status: payload.status?.trim() || "completed",
    updated_at: payload.completed_at?.trim() || new Date().toISOString(),
  };
}

function nexusPayloadMatchesDeal(payload: NexusContactNotePayload, lead: DealEngineLead) {
  if (payload.source_lead_id?.trim() === lead.id) return true;

  const payloadAddress = payload.property_address?.trim() ?? "";
  const payloadOwner = payload.owner_name?.trim() ?? "";
  const addressMatches = payloadAddress ? addressesLikelyMatch(payloadAddress, lead.propertyAddress) : false;
  if (!addressMatches) return false;

  if (!payloadOwner) return true;
  const normalizedPayloadOwner = normalizeContactMatch(payloadOwner);
  const normalizedLeadOwner = normalizeContactMatch(lead.ownerName);
  return (
    normalizedPayloadOwner === normalizedLeadOwner
    || normalizedPayloadOwner.includes(normalizedLeadOwner)
    || normalizedLeadOwner.includes(normalizedPayloadOwner)
    || /heirs|estate|trust/i.test(payloadOwner)
    || /heirs|estate|trust/i.test(lead.ownerName)
  );
}

async function findGenericNexusContactNoteForDeal(
  supabase: SupabaseClient,
  lead: DealEngineLead,
): Promise<NexusContactRow | null> {
  const { data, error } = await supabase
    .from("lead_notes")
    .select("note,created_at")
    .ilike("note", "NEXUS_CONTACT_RESULT %")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !data?.length) return null;

  for (const note of data as Array<{ note: string }>) {
    const payload = parseNexusContactNote(note.note);
    if (payload && nexusPayloadMatchesDeal(payload, lead)) return nexusPayloadToContactRow(payload, lead);
  }

  return null;
}

async function findNexusContactNoteForDeal(
  supabase: SupabaseClient,
  lead: DealEngineLead,
): Promise<NexusContactRow | null> {
  const { data, error } = await supabase
    .from("seller_leads")
    .select("id,owners(name,mailing_address),properties(property_address,city,state,zip_code)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !data?.length) return findGenericNexusContactNoteForDeal(supabase, lead);

  const sellerLead = (data as unknown as SellerLeadContactLookupRow[]).find((row) => {
    const sellerOwnerName = normalizeContactMatch(row.owners?.name ?? "");
    const dealOwnerName = normalizeContactMatch(lead.ownerName);
    const ownerMatches =
      Boolean(sellerOwnerName)
      && (sellerOwnerName === dealOwnerName || dealOwnerName.includes(sellerOwnerName));
    const addressMatches =
      addressesLikelyMatch(row.properties?.property_address ?? "", lead.propertyAddress)
      || addressesLikelyMatch(formatSellerPropertyAddress(row.properties), lead.propertyAddress);
    return ownerMatches && addressMatches;
  });

  if (!sellerLead) return findGenericNexusContactNoteForDeal(supabase, lead);

  const { data: notes, error: notesError } = await supabase
    .from("lead_notes")
    .select("note,created_at")
    .eq("seller_lead_id", sellerLead.id)
    .ilike("note", "NEXUS_CONTACT_RESULT %")
    .order("created_at", { ascending: false })
    .limit(10);

  if (notesError || !notes?.length) return findGenericNexusContactNoteForDeal(supabase, lead);

  for (const note of notes as Array<{ note: string }>) {
    const payload = parseNexusContactNote(note.note);
    if (payload) return nexusPayloadToContactRow(payload, lead, sellerLead);
  }

  return findGenericNexusContactNoteForDeal(supabase, lead);
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

  if (!recentError && recentContacts?.length) {
    const matchedContact = (recentContacts as NexusContactRow[]).find((contact) =>
    normalizeContactMatch(contact.owner_name) === normalizeContactMatch(lead.ownerName)
    && normalizeContactMatch(contact.property_address) === normalizeContactMatch(lead.propertyAddress)
    ) ?? null;
    if (matchedContact) return matchedContact;
  }

  return findNexusContactNoteForDeal(supabase, lead);
}

function enrichPacketWithSellerContactStatus(
  packet: DealEngineDealDetail["packet"],
  sellerContact: DealEngineDealDetail["sellerContact"],
): DealEngineDealDetail["packet"] {
  if (sellerContact.ownerPhone === "Not captured" && !/trace complete|contact ready/i.test(sellerContact.phoneStatus)) {
    return packet;
  }

  return {
    ...packet,
    contactInstructions:
      "Seller contact has been verified internally through Nexus. Keep buyer questions, walkthrough requests, proof-of-funds review, and offer routing inside Blackspire Deal Engine; do not expose seller direct contact details in buyer-facing packets.",
  };
}

function isDuplicateInsertError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

async function ensureDealExecutionScaffold(
  supabase: SupabaseClient,
  lead: DealEngineLead,
  contractDraft: DealEngineContractDraft | null,
  packet: DealEngineDealDetail["packet"],
  room: DealEngineDealDetail["room"],
) {
  const contractInsert = await supabase.from("contracts").insert({
    lead_id: lead.id,
    offer_made: false,
    offer_accepted: false,
    contract_sent: false,
    contract_signed: false,
    inspection_period: "14 days",
    earnest_money_deposit: Number((contractDraft?.earnestMoney ?? "$3000").replace(/[^0-9.-]/g, "")) || 3000,
    assignment_status: contractDraft?.contractType ?? "Drafting",
  });
  if (contractInsert.error && !isDuplicateInsertError(contractInsert.error)) {
    throw new Error(contractInsert.error.message);
  }

  const packetInsert = await supabase.from("deal_packets").insert({
    lead_id: lead.id,
    property_notes: packet.propertyNotes,
    investor_summary: packet.investorSummary,
    buyer_email_blast: packet.buyerEmailBlast,
    buyer_sms_alert: packet.buyerSmsAlert,
    contact_instructions: packet.contactInstructions,
    deadline_to_submit_offer: packet.deadlineToSubmitOffer,
    comps_placeholder: packet.comps,
  });
  if (packetInsert.error && !isDuplicateInsertError(packetInsert.error)) {
    throw new Error(packetInsert.error.message);
  }

  const roomInsert = await supabase.from("deal_rooms").insert({
    lead_id: lead.id,
    slug: room.slug,
    property_summary: room.propertySummary,
    financial_breakdown: room.financialBreakdown,
    photos: [],
    map_placeholder: room.mapPlaceholder,
    comps_placeholder: room.compsPlaceholder,
    downloadable_pdf_label: room.downloadablePdfLabel,
    submit_interest_label: room.submitInterestLabel,
    request_walkthrough_label: room.requestWalkthroughLabel,
  });
  if (roomInsert.error && !isDuplicateInsertError(roomInsert.error)) {
    throw new Error(roomInsert.error.message);
  }
}

const DEAL_DOCUMENT_BUCKET = "deal-engine-documents";

async function ensureDealDocumentBucket(supabase: SupabaseClient) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(error.message);
  }

  const exists = (buckets ?? []).some((bucket) => bucket.name === DEAL_DOCUMENT_BUCKET);
  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(DEAL_DOCUMENT_BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
  });

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message);
  }
}

function safeDocumentPathSegment(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "file";
}

function getDealDocumentObjectPath(input: { dealId: string; category: string; fileName: string }) {
  const safeCategory = safeDocumentPathSegment(input.category);
  const safeName = safeDocumentPathSegment(input.fileName);
  return `${input.dealId}/${Date.now()}-${safeCategory}-${safeName}`;
}

async function syncDealBuyerMatches(
  supabase: SupabaseClient,
  lead: DealEngineLead,
  buyerSignals: RankedBuyerSignal[],
) {
  if (!buyerSignals.length) return;

  const topBuyer = buyerSignals[0];
  const shortlist = buyerSignals.slice(0, 5).map((signal) => ({
    buyerSignalId: signal.id,
    buyerName: signal.buyerName,
    market: signal.market,
    propertyType: signal.propertyType,
    searchJobId: signal.searchJobId,
    score: signal.score,
    purchaseCount: signal.purchaseCount,
    totalSpend: signal.totalSpend,
    outreachSubject: signal.outreachSubject,
    outreachAngle: signal.outreachAngle,
    matchScore: signal.matchScore,
    matchReason: signal.matchReason,
  }));

  const { error } = await supabase.from("buyer_matches").upsert({
    lead_id: lead.id,
    county: lead.county,
    state: "NC",
    property_type: normalizeDealLane(lead),
    exit_strategy: lead.exitStrategy,
    buyer_score: topBuyer.matchScore,
    investor_type_recommendation: buildInvestorTypeRecommendation(lead, buyerSignals),
    export_ready_deal_data: `Top buyer shortlist synced from live Buyer Engine results for ${lead.propertyAddress}.`,
    top_buyer_matches: shortlist,
    updated_at: new Date().toISOString(),
  }, { onConflict: "lead_id" });

  if (error) {
    throw new Error(error.message);
  }
}

function isOutreachDraftAuthBlock(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /sign in required|no operator account exists yet|use \/auth before creating/i.test(message);
}

function isBuyerSearchAuthBlock(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /sign in required|no operator account exists yet|use \/auth before creating/i.test(message);
}

async function createBuyerSearchJobWithFallback(input: {
  state: string;
  county: string;
  propertyType: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  minPurchases: number;
}) {
  try {
    return await createSearchJob({
      title: `${input.county} buyer search`,
      state: input.state,
      county: input.county,
      propertyType: input.propertyType,
      dateRangeStart: input.dateRangeStart,
      dateRangeEnd: input.dateRangeEnd,
      minPurchases: input.minPurchases,
      notes: "",
    });
  } catch (error) {
    if (!isBuyerSearchAuthBlock(error)) throw error;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error(`Missing Supabase env: ${getEnvState().missing.join(", ")}`);
  }

  const { data: recentJobs, error: recentJobsError } = await supabase
    .from("SearchJob")
    .select("user_id,created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  if (recentJobsError) {
    throw new Error(recentJobsError.message);
  }

  const fallbackUserId =
    (recentJobs ?? [])
      .map((row) => String((row as { user_id?: string | null }).user_id ?? "").trim())
      .find((value) => value && value !== "00000000-0000-0000-0000-000000000000")
    || (recentJobs ?? [])
      .map((row) => String((row as { user_id?: string | null }).user_id ?? "").trim())
      .find(Boolean)
    || null;

  if (!fallbackUserId) {
    throw new Error("Buyer search launch needs an operator scope. Sign in at /auth before creating the first buyer search.");
  }

  const { data, error } = await supabase
    .from("SearchJob")
    .insert({
      user_id: fallbackUserId,
      state: input.state.trim().toUpperCase(),
      county: input.county.trim(),
      property_type: input.propertyType,
      date_range_start: input.dateRangeStart,
      date_range_end: input.dateRangeEnd,
      min_purchases: input.minPurchases,
      cash_buyers_only: false,
      llc_buyers_only: false,
      status: "pending",
    })
    .select("id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SearchJobRecord;
}

function parseBuyerDraftsFromLogs(logs: DispositionLogRow[]) {
  return logs
    .filter((log) => log.action_type === "buyer_draft_created" && log.payload)
    .map((log) => {
      const payload = log.payload ?? {};
      const buyerName = String(payload.buyerName ?? "").trim();
      const subject = String(payload.subject ?? "").trim();
      const body = String(payload.body ?? "").trim();
      if (!buyerName || !subject || !body) return null;

      return {
        id: String(log.id),
        buyerName,
        subject,
        angle: String(payload.angle ?? ""),
        body,
        createdAt: String(payload.createdAt ?? log.created_at ?? new Date().toISOString()),
      };
    })
    .filter((draft): draft is NonNullable<typeof draft> => Boolean(draft));
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
    firstTouchSms: `Hi ${ownerName}, this is Carlos with Blackspire Helix Group. I’m reaching out about ${address}. If you’d ever consider selling it as-is instead of fixing it up or listing it, I’d be happy to share what a simple direct offer could look like.`,
    followUpSms: `Hi ${ownerName}, just following up on ${address}. Depending on condition and timing, we may be able to make a straightforward offer ${pricing ? `somewhere ${pricing}` : ""}. If it helps, I can keep it simple and just give you a quick idea of how we work.`,
    emailSubject: `Quick question about ${address}`,
    emailBody: `Hi ${ownerName},\n\nThis is Carlos Pearson with Blackspire Helix Group. I wanted to reach out about ${address}.\n\nWe work with owners who would rather sell a property as-is than spend time on repairs, showings, or listing prep. ${summary}\n\nIf selling is something you would consider, I can walk you through a simple next step and let you decide whether it makes sense. From our side, the goal is usually ${closeAngle}.\n\nNo pressure either way. If now is not the right time, I completely understand.\n\nBest,\nCarlos Pearson\nBlackspire Helix Group`,
    objectionReply: `That makes sense, and I appreciate you saying that. A lot of owners are comparing a direct sale with fixing the property up or listing it. The only thing I’d want to offer is a simpler option with fewer moving parts. ${action} If it’s not a fit right now, no problem at all.`,
    voicemailScript: `Hi ${ownerName}, this is Carlos with Blackspire Helix Group calling about ${address}. I just wanted to see if you’d ever consider selling the property as-is. If you want, you can call or text me back whenever it’s convenient.`,
    callOpener: `Hi ${ownerName}, this is Carlos Pearson with Blackspire Helix Group. I’m calling about ${address}. Do you have a quick minute for one question about the property?`,
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

function parseOutreachExecutions(logs: DispositionLogRow[]) {
  return logs
    .filter((log) => log.action_type === "outreach_execution_logged")
    .map((log) => {
      const payload = log.payload ?? {};
      return {
        id: String(log.id),
        audience: String(payload.audience ?? "seller"),
        channel: String(payload.channel ?? "sms"),
        recipient: String(payload.recipient ?? "Unknown recipient"),
        status: String(payload.status ?? "Logged"),
        outcome: String(payload.outcome ?? "No outcome recorded."),
        nextStep: String(payload.nextStep ?? ""),
        notes: String(payload.notes ?? ""),
        loggedAt: String(payload.loggedAt ?? log.created_at ?? new Date().toISOString()),
      };
    })
    .sort((left, right) => Date.parse(right.loggedAt) - Date.parse(left.loggedAt));
}

function parseUploadedDocuments(logs: DispositionLogRow[]) {
  return logs
    .filter((log) => log.action_type === "document_uploaded" && log.payload)
    .map((log) => ({
      id: String(log.payload?.documentId ?? log.id),
      category: String(log.payload?.category ?? "Document"),
      name: String(log.payload?.name ?? log.payload?.fileName ?? "Uploaded document"),
      fileName: String(log.payload?.fileName ?? "document"),
      contentType: String(log.payload?.contentType ?? "application/octet-stream"),
      sizeBytes: Number(log.payload?.sizeBytes ?? 0),
      owner: String(log.payload?.owner ?? "Blackspire operator"),
      status: String(log.payload?.status ?? "Received"),
      notes: String(log.payload?.notes ?? ""),
      source: String(log.payload?.source ?? "internal"),
      uploadedAt: String(log.payload?.uploadedAt ?? log.created_at ?? new Date().toISOString()),
      storagePath: String(log.payload?.storagePath ?? ""),
    }))
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

function parseCloseout(logs: DispositionLogRow[]) {
  const log = [...logs]
    .filter((entry) => entry.action_type === "deal_closeout_recorded")
    .sort((left, right) => Date.parse(String(right.created_at ?? 0)) - Date.parse(String(left.created_at ?? 0)))[0];

  if (!log) return null;

  const payload = log.payload ?? {};
  return {
    outcome: String(payload.outcome ?? "Closed"),
    closedAt: String(payload.closedAt ?? ""),
    assignmentFeeCollected: clampMoney(Number(payload.assignmentFeeCollected ?? 0)),
    buyerName: String(payload.buyerName ?? ""),
    notes: String(payload.notes ?? ""),
    recordedAt: String(payload.recordedAt ?? log.created_at ?? new Date().toISOString()),
  };
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

    if (log.action_type === "analysis_update") {
      return {
        id: String(log.id),
        title: "Underwriting updated",
        detail: String(payload.nextAction ?? "Deal analysis inputs were updated."),
        timestamp,
        tone: "warn" as const,
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

    if (log.action_type === "buyer_search_launched") {
      return {
        id: String(log.id),
        title: `Buyer search launched: ${String(payload.jobId ?? "SearchJob")}`,
        detail: String(payload.notes ?? "Buyer Engine search launched from Deal Engine."),
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

    if (log.action_type === "outreach_execution_logged") {
      return {
        id: String(log.id),
        title: `${String(payload.audience ?? "Outreach")} outreach logged`,
        detail: `${String(payload.channel ?? "channel")} / ${String(payload.status ?? "status")} / ${String(payload.recipient ?? "recipient")}`,
        timestamp,
        tone: "active" as const,
      };
    }

    if (log.action_type === "document_uploaded") {
      return {
        id: String(log.id),
        title: `Document uploaded: ${String(payload.category ?? "Document")}`,
        detail: String(payload.fileName ?? payload.name ?? "File uploaded to the deal room."),
        timestamp,
        tone: "active" as const,
      };
    }

    if (log.action_type === "email_sent") {
      return {
        id: String(log.id),
        title: `Email sent: ${String(payload.audience ?? "deal lane")}`,
        detail: `${String(payload.to ?? "recipient")} / ${String(payload.subject ?? "subject")}`,
        timestamp,
        tone: "good" as const,
      };
    }

    if (log.action_type === "deal_closeout_recorded") {
      return {
        id: String(log.id),
        title: `Deal closeout: ${String(payload.outcome ?? "Closed")}`,
        detail: String(payload.notes ?? payload.buyerName ?? "Closeout recorded."),
        timestamp,
        tone: "good" as const,
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

  if (isMissingDealTableError(existing.error)) {
    const alreadySent = sellerLead.status === "Sent to Deal Engine";
    await updateSellerLead(sellerLead.id, { status: "Sent to Deal Engine" });
    return {
      ok: true as const,
      dealId: sellerLead.id,
      created: !alreadySent,
    };
  }

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

  const contractSeed = await supabase.from("contracts").insert({
    lead_id: input.dealId,
    offer_made: false,
    offer_accepted: false,
    contract_sent: false,
    contract_signed: false,
    inspection_period: "14 days",
    earnest_money_deposit: input.earnestMoney,
    assignment_status: input.contractType,
  });
  if (contractSeed.error && !isDuplicateInsertError(contractSeed.error)) {
    return { ok: false as const, error: contractSeed.error.message };
  }

  const purchaseTarget = Math.round((input.offerLow + input.offerHigh) / 2);
  const offerMade = input.offerHigh > 0;
  const complianceSummary = buildWholesalingComplianceSnapshot(input.contractType);

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
        complianceSummary,
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

export async function saveDealAnalysis(input: SaveDealAnalysisInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const estimatedArv = clampMoney(input.estimatedArv);
  const sellerAskingPrice = clampMoney(input.sellerAskingPrice);
  const repairEstimate = clampMoney(input.repairEstimate);
  const closingCosts = clampMoney(input.closingCosts);
  const holdingCosts = clampMoney(input.holdingCosts);
  const buyerProfitTarget = clampMoney(input.buyerProfitTarget);
  const assignmentFeeTarget = clampMoney(input.assignmentFeeTarget);
  const rentalEstimate = clampMoney(input.rentalEstimate);
  const flipEstimate = clampMoney(input.flipEstimate);
  const maximumAllowableOffer = clampMoney(
    estimatedArv - repairEstimate - closingCosts - holdingCosts - buyerProfitTarget - assignmentFeeTarget,
  );
  const purchasePriceTarget = maximumAllowableOffer;
  const wholesaleSpread = clampMoney(estimatedArv - purchasePriceTarget - repairEstimate - closingCosts - holdingCosts);
  const missingInputs = [
    estimatedArv <= 0 ? "ARV missing" : null,
    repairEstimate <= 0 ? "repairs missing" : null,
    sellerAskingPrice <= 0 ? "seller ask missing" : null,
  ].filter(Boolean);
  const dealRating = missingInputs.length
    ? "Needs Underwriting"
    : maximumAllowableOffer > 0 && wholesaleSpread >= assignmentFeeTarget
      ? "Green Deal"
      : "Yellow Deal";
  const complianceChecklist = [
    "Use written equitable-interest disclosure with the seller.",
    "Verify assignment is expressly allowed before marketing the deal.",
    "Keep earnest money routed through title or escrow.",
    "Check state-specific cancellation and licensing rules before contract send.",
  ];
  const compliance = buildWholesalingComplianceSnapshot("Assignable purchase agreement");
  const nextAction = missingInputs.length
    ? "Finish underwriting inputs before setting final contract posture."
    : `Underwriting complete. Review MAO ${formatCurrency(maximumAllowableOffer)}, confirm seller terms, and save the contract posture.`;

  const underwritingTask = {
    lead_id: input.dealId,
    action_type: "operator_task",
    payload: {
      taskId: `underwriting-follow-up-${input.dealId}`,
      title: missingInputs.length
        ? "Collect missing underwriting inputs"
        : "Review contract posture and send offer",
      owner: "Acquisitions",
      dueDate: "",
      priority: "High",
      status: missingInputs.length ? "Open" : "In Progress",
      notes: missingInputs.length
        ? `Still needed before contract drafting: ${missingInputs.join("; ")}.`
        : `Underwriting is complete. Review MAO ${formatCurrency(maximumAllowableOffer)}, confirm seller response, and move into contract. `,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  const [analysisUpsert, leadUpdate, conversationUpdate, logInsert, taskInsert] = await Promise.all([
    supabase.from("deal_analysis").upsert({
      lead_id: input.dealId,
      estimated_arv: estimatedArv,
      purchase_price_target: purchasePriceTarget,
      seller_asking_price: sellerAskingPrice || null,
      repair_estimate: repairEstimate,
      closing_costs: closingCosts,
      holding_costs: holdingCosts,
      buyer_profit_target: buyerProfitTarget,
      assignment_fee_target: assignmentFeeTarget,
      rental_estimate: rentalEstimate,
      flip_estimate: flipEstimate,
      wholesale_spread: wholesaleSpread,
      maximum_allowable_offer: maximumAllowableOffer,
      deal_rating: dealRating,
      updated_at: new Date().toISOString(),
    }, { onConflict: "lead_id" }),
    supabase.from("deal_leads").update({
      status: missingInputs.length ? "Underwriting" : "Offer Ready",
      recommended_next_action: nextAction,
      updated_at: new Date().toISOString(),
    }).eq("id", input.dealId),
    supabase.from("seller_conversations").update({
      seller_asking_price: sellerAskingPrice || null,
      next_action: nextAction,
      updated_at: new Date().toISOString(),
    }).eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "analysis_update",
      payload: {
        estimatedArv,
        sellerAskingPrice,
        repairEstimate,
        closingCosts,
        holdingCosts,
        buyerProfitTarget,
        assignmentFeeTarget,
        rentalEstimate,
        flipEstimate,
        maximumAllowableOffer,
        purchasePriceTarget,
        wholesaleSpread,
        dealRating,
        missingInputs,
        complianceChecklist,
        nextAction,
        updatedAt: new Date().toISOString(),
      },
    }),
    supabase.from("disposition_logs").insert(underwritingTask),
  ]);

  const error =
    analysisUpsert.error?.message
    || leadUpdate.error?.message
    || conversationUpdate.error?.message
    || logInsert.error?.message
    || taskInsert.error?.message;
  if (error) {
    return { ok: false as const, error };
  }

  return {
    ok: true as const,
    underwriting: {
      estimatedArv,
      sellerAskingPrice,
      repairEstimate,
      closingCosts,
      holdingCosts,
      buyerProfitTarget,
      assignmentFeeTarget,
      rentalEstimate,
      flipEstimate,
      maximumAllowableOffer,
      purchasePriceTarget,
      wholesaleSpread,
      dealRating,
      missingInputs,
      readyForContract: missingInputs.length === 0 && maximumAllowableOffer > 0,
      compliance,
    },
  };
}

export async function estimateDealArv(input: EstimateDealArvInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const { data: dealRow, error: dealError } = await supabase
    .from("deal_leads")
    .select("id,seller_lead_id,property_address,county,city,property_type,assessed_value,estimated_equity")
    .eq("id", input.dealId)
    .maybeSingle();

  if (dealError) {
    return { ok: false as const, error: dealError.message };
  }
  if (!dealRow) {
    return { ok: false as const, error: "Deal not found." };
  }

  const { data: analysisRow, error: analysisError } = await supabase
    .from("deal_analysis")
    .select("estimated_arv,seller_asking_price,repair_estimate,closing_costs,holding_costs,buyer_profit_target,assignment_fee_target,rental_estimate,flip_estimate")
    .eq("lead_id", input.dealId)
    .maybeSingle();

  if (analysisError) {
    return { ok: false as const, error: analysisError.message };
  }

  const sellerLead = (await listSellerLeads().catch(() => [])).find((lead) =>
    lead.id === String(dealRow.seller_lead_id ?? "")
    || addressesLikelyMatch(lead.propertyAddress, String(dealRow.property_address ?? "")),
  );

  const { data: linkedSellerLead } = dealRow.seller_lead_id
    ? await supabase
      .from("seller_leads")
      .select("id,property_id")
      .eq("id", String(dealRow.seller_lead_id))
      .maybeSingle()
    : { data: null };

  const { data: linkedProperty } = linkedSellerLead?.property_id
    ? await supabase
      .from("properties")
      .select("assessed_value")
      .eq("id", String(linkedSellerLead.property_id))
      .maybeSingle()
    : { data: null };

  const marketMedian = await findMarketMedianAssessedValue({
    supabase,
    county: String(dealRow.county ?? sellerLead?.county ?? "Unknown"),
    city: String(dealRow.city ?? sellerLead?.city ?? ""),
    propertyType: String(dealRow.property_type ?? sellerLead?.propertyType ?? "Single Family"),
  });

  let assessedValue = clampMoney(Number(dealRow.assessed_value ?? 0));
  let valueSource: "deal" | "linked-property" | "seller-lead" | "market-median" = "deal";

  if (assessedValue <= 0) {
    assessedValue = clampMoney(Number(linkedProperty?.assessed_value ?? 0));
    valueSource = "linked-property";
  }

  if (assessedValue <= 0) {
    assessedValue = clampMoney(sellerLead?.assessedValue ?? 0);
    valueSource = "seller-lead";
  }

  if (assessedValue <= 0 && marketMedian) {
    assessedValue = marketMedian.assessedValue;
    valueSource = "market-median";
  }

  if (assessedValue <= 0) {
    return { ok: false as const, error: "No assessed value or same-market property baseline is available yet for this deal, so ARV cannot be estimated." };
  }

  const estimate = estimateArvFromSignals({
    assessedValue,
    county: String(dealRow.county ?? sellerLead?.county ?? "Unknown"),
    propertyType: String(dealRow.property_type ?? sellerLead?.propertyType ?? "Single Family"),
    hasVacancy: Boolean(sellerLead?.signals.vacant),
    hasCodeViolation: Boolean(sellerLead?.signals.codeViolation),
    hasTaxPressure: Boolean(sellerLead?.signals.taxDelinquent),
    hasForeclosure: Boolean(sellerLead?.signals.foreclosure),
    hasProbate: Boolean(sellerLead?.signals.probate),
    valueSource,
  });

  const saveResult = await saveDealAnalysis({
    dealId: input.dealId,
    estimatedArv: estimate.estimatedArv,
    sellerAskingPrice: clampMoney(Number(analysisRow?.seller_asking_price ?? 0)),
    repairEstimate: clampMoney(Number(analysisRow?.repair_estimate ?? 0)),
    closingCosts: clampMoney(Number(analysisRow?.closing_costs ?? 0)),
    holdingCosts: clampMoney(Number(analysisRow?.holding_costs ?? 0)),
    buyerProfitTarget: clampMoney(Number(analysisRow?.buyer_profit_target ?? 0)),
    assignmentFeeTarget: clampMoney(Number(analysisRow?.assignment_fee_target ?? 0)),
    rentalEstimate: clampMoney(Number(analysisRow?.rental_estimate ?? 0)),
    flipEstimate: clampMoney(Number(analysisRow?.flip_estimate ?? 0)),
  });

  if (!saveResult.ok) {
    return saveResult;
  }

  await supabase.from("disposition_logs").insert({
    lead_id: input.dealId,
    action_type: "analysis_update",
    payload: {
      estimateOnly: true,
      estimatedArv: estimate.estimatedArv,
      arvRange: `${formatCurrency(estimate.rangeLow)} - ${formatCurrency(estimate.rangeHigh)}`,
      confidence: estimate.confidence,
      basis: estimate.basis,
      updatedAt: new Date().toISOString(),
    },
  });

  return {
    ok: true as const,
    message: `ARV estimated at ${formatCurrency(estimate.estimatedArv)} and saved into underwriting.`,
    estimatedArv: estimate.estimatedArv,
    arvRange: `${formatCurrency(estimate.rangeLow)} - ${formatCurrency(estimate.rangeHigh)}`,
    confidence: estimate.confidence,
    basis: marketMedian && valueSource === "market-median"
      ? `${estimate.basis} Median pulled from ${marketMedian.sampleCount} ${marketMedian.scope}-level ${marketMedian.valuationBucket} property records.`
      : estimate.basis,
    underwriting: saveResult.underwriting,
  };
}

export async function launchBuyerSearchFromDeal(input: LaunchBuyerSearchFromDealInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const detail = await getDealEngineDealDetail(input.dealId);
  if (!detail) {
    return { ok: false as const, error: "Deal could not be found." };
  }

  const propertyType = normalizeDealLane(detail.lead) === "land" ? "land" : "all";
  const launchBlock = getCountyLaunchBlock(detail.lead.county, propertyType);
  if (launchBlock.blocked) {
    return { ok: false as const, error: launchBlock.reason };
  }
  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd);
  rangeStart.setMonth(rangeStart.getMonth() - 6);

  const title = `Deal Engine buyer search / ${detail.lead.county} / ${input.dealId}`;
  const notes = [
    `Launched from Deal Engine for ${detail.lead.propertyAddress}.`,
    `Deal ID: ${input.dealId}.`,
    `Current stage: ${detail.lead.status}.`,
    `Buyer lane objective: replace fallback shortlist with county-specific matches.`,
  ].join(" ");

  try {
    const job = await createBuyerSearchJobWithFallback({
      state: "NC",
      county: detail.lead.county,
      propertyType,
      dateRangeStart: toIsoDateString(rangeStart),
      dateRangeEnd: toIsoDateString(rangeEnd),
      minPurchases: 2,
    });

    const [dealUpdate, conversationUpdate, logInsert, taskInsert] = await Promise.all([
      supabase.from("deal_leads").update({
        recommended_next_action: `Buyer search ${job.id} launched for ${detail.lead.county} County. Wait for Buyer Engine results, then refresh the shortlist and packet.`,
        updated_at: new Date().toISOString(),
      }).eq("id", input.dealId),
      supabase.from("seller_conversations").update({
        next_action: `Buyer search ${job.id} launched. Review buyer results before sending broad dispo outreach.`,
        updated_at: new Date().toISOString(),
      }).eq("lead_id", input.dealId),
      supabase.from("disposition_logs").insert({
        lead_id: input.dealId,
        action_type: "buyer_search_launched",
        payload: {
          jobId: job.id,
          county: job.county,
          state: job.state,
          propertyType: job.property_type,
          dateRangeStart: job.date_range_start,
          dateRangeEnd: job.date_range_end,
          title,
          notes,
          createdAt: new Date().toISOString(),
        },
      }),
      supabase.from("disposition_logs").insert({
        lead_id: input.dealId,
        action_type: "operator_task",
        payload: {
          taskId: `buyer-search-follow-up-${input.dealId}`,
          title: "Review Buyer Engine results and refresh shortlist",
          owner: "Disposition",
          dueDate: "",
          priority: "High",
          status: "Open",
          notes: `Buyer search ${job.id} was launched for ${detail.lead.county} County. Refresh deal buyer matches once the job completes.`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    ]);

    const error =
      dealUpdate.error?.message
      || conversationUpdate.error?.message
      || logInsert.error?.message
      || taskInsert.error?.message;
    if (error) {
      return { ok: false as const, error };
    }

    return {
      ok: true as const,
      job,
      workflow: {
        webhookUrl: `${process.env.N8N_WEBHOOK_BASE_URL?.replace(/\/$/, "") || "https://cpearson0312.app.n8n.cloud/webhook"}/buyer-engine`,
        dispatch: "queued" as const,
      },
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Buyer search launch failed.",
    };
  }
}

export async function recordBuyerSearchDispatchFailure(input: {
  dealId: string;
  jobId: string;
  error: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const nextAction = `Buyer search ${input.jobId} was created, but the external Buyer Engine workflow did not start cleanly. Retry the dispatch from Buyer Engine or check the workflow service before relying on fresh shortlist results.`;
  const now = new Date().toISOString();

  const [dealUpdate, conversationUpdate, logInsert, taskInsert] = await Promise.all([
    supabase.from("deal_leads").update({
      recommended_next_action: nextAction,
      updated_at: now,
    }).eq("id", input.dealId),
    supabase.from("seller_conversations").update({
      next_action: nextAction,
      updated_at: now,
    }).eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "buyer_search_dispatch_failed",
      payload: {
        jobId: input.jobId,
        error: input.error,
        loggedAt: now,
      },
    }),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "operator_task",
      payload: {
        taskId: `buyer-search-dispatch-retry-${input.jobId}`,
        title: "Retry Buyer Engine workflow dispatch",
        owner: "Disposition",
        dueDate: "",
        priority: "High",
        status: "Open",
        notes: `Buyer search ${input.jobId} was created, but the downstream workflow returned an error: ${input.error}`,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ]);

  const error =
    dealUpdate.error?.message
    || conversationUpdate.error?.message
    || logInsert.error?.message
    || taskInsert.error?.message;

  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const, nextAction };
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
    subject: `Quick deal in ${deal.county} County`,
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

  let drafts: OutreachDraftRecord[] = [];
  let storageError: unknown = null;
  try {
    drafts = await persistOutreachDraftRecord(record);
  } catch (error) {
    storageError = error;
    if (!isOutreachDraftAuthBlock(error)) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Buyer outreach draft persistence failed.",
      };
    }
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "buyer_draft_created",
      payload: {
        buyerName: record.buyerName,
        subject: record.subject,
        angle: record.angle,
        body: record.body,
        searchJobId: record.searchJobId,
        buyerSignalId: record.id,
        createdAt: record.createdAt,
        storage: storageError ? "deal-log-fallback" : "server",
      },
    });
    if (error) {
      return { ok: false as const, error: error.message };
    }
  }

  return { ok: true as const, draft: record, drafts };
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

  let leadId = input.dealId?.trim() || null;
  if (!leadId && input.slug?.trim()) {
    const { data: room } = await supabase
      .from("deal_rooms")
      .select("lead_id")
      .eq("slug", input.slug.trim())
      .maybeSingle();

    leadId = room && typeof room === "object" && "lead_id" in room ? String(room.lead_id) : null;
  }
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

// Hard required-field gate: block advancing a deal to a gated stage when the
// prerequisites are missing, and say exactly what is blocking.
export async function validateDealStageAdvancement(dealId: string, targetStatus: string): Promise<string[]> {
  const detail = await getDealEngineDealDetail(dealId).catch(() => null);
  if (!detail) return [];
  const c = detail.coordination;
  const t = (targetStatus ?? "").toLowerCase();
  const reasons: string[] = [];

  if (/(under contract|executed|signed)/.test(t) && !c.contractSigned && !c.contractSent) {
    reasons.push("contract has not been sent or signed");
  }
  if (/(assigned|buyer locked|disposition|assignment)/.test(t) && !/assigned|matched|locked|under contract/i.test(c.buyerAssignmentStatus ?? "")) {
    reasons.push("no buyer is assigned");
  }
  if (/(clear to close|closing|ready to close)/.test(t)) {
    if (!/received|collected|deposited|funded/i.test(c.earnestMoneyStatus ?? "")) reasons.push("EMD has not been received");
    if (!(c.titleCompany ?? "").trim()) reasons.push("no title company assigned");
  }
  if (/(closed|complete|funded|settled|disbursed)/.test(t)) {
    if (!c.contractSigned) reasons.push("contract is not signed");
    if (!(c.closingDate ?? "").trim()) reasons.push("no closing date set");
  }
  return reasons;
}

export async function saveDealStageUpdate(input: SaveDealStageUpdateInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const blocking = await validateDealStageAdvancement(input.dealId, input.status);
  if (blocking.length) {
    return {
      ok: false as const,
      error: `Cannot advance to "${input.status}" — blocked by: ${blocking.join("; ")}.`,
      blocking,
    };
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

export async function uploadDealDocument(input: UploadDealDocumentInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  await ensureDealDocumentBucket(supabase);
  const objectPath = getDealDocumentObjectPath({
    dealId: input.dealId,
    category: input.category,
    fileName: input.fileName,
  });

  const { error: uploadError } = await supabase.storage
    .from(DEAL_DOCUMENT_BUCKET)
    .upload(objectPath, input.bytes, {
      contentType: input.contentType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return { ok: false as const, error: uploadError.message };
  }

  const documentId = `document-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const uploadedAt = new Date().toISOString();
  const { error: logError } = await supabase.from("disposition_logs").insert({
    lead_id: input.dealId,
    action_type: "document_uploaded",
    payload: {
      documentId,
      category: input.category,
      name: `${input.category} / ${input.fileName}`,
      fileName: input.fileName,
      contentType: input.contentType || "application/octet-stream",
      sizeBytes: input.bytes.byteLength,
      owner: input.owner,
      status: input.status,
      notes: input.notes,
      source: input.source,
      storagePath: objectPath,
      uploadedAt,
    },
  });

  if (logError) {
    return { ok: false as const, error: logError.message };
  }

  await supabase.from("deal_documents").upsert({
    deal_id: input.dealId,
    document_id: documentId,
    file_name: input.fileName,
    file_type: input.contentType || "application/octet-stream",
    category: input.category,
    uploaded_by: input.owner,
    uploaded_at: uploadedAt,
    document_url: `/api/deal-engine/document?dealId=${encodeURIComponent(input.dealId)}&documentId=${encodeURIComponent(documentId)}`,
    storage_path: objectPath,
    notes: input.notes,
    linked_item_type: "",
    linked_item_id: "",
    updated_at: uploadedAt,
  }, { onConflict: "document_id" }).then(() => undefined, () => undefined);

  return { ok: true as const, documentId };
}

export async function downloadDealDocument(dealId: string, documentId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const { data: logs, error } = await supabase
    .from("disposition_logs")
    .select("payload")
    .eq("lead_id", dealId)
    .eq("action_type", "document_uploaded")
    .order("created_at", { ascending: false });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  const payload = (logs ?? [])
    .map((entry) => (entry && typeof entry === "object" && "payload" in entry ? entry.payload as Record<string, unknown> : null))
    .find((entry) => String(entry?.documentId ?? "") === documentId);

  if (!payload) {
    return { ok: false as const, error: "Document not found." };
  }

  const storagePath = String(payload.storagePath ?? "");
  if (!storagePath) {
    return { ok: false as const, error: "Document storage path is missing." };
  }

  const { data, error: downloadError } = await supabase.storage
    .from(DEAL_DOCUMENT_BUCKET)
    .download(storagePath);

  if (downloadError || !data) {
    return { ok: false as const, error: downloadError?.message ?? "Unable to download document." };
  }

  return {
    ok: true as const,
    data,
    fileName: String(payload.fileName ?? "document"),
    contentType: String(payload.contentType ?? "application/octet-stream"),
  };
}

export async function sendDealEmail(input: SendDealEmailInput) {
  if (!isResendConfigured()) {
    return { ok: false as const, error: "RESEND_API_KEY is not configured for email sending yet." };
  }

  const sendResult = await sendReconEmail({
    to: input.to,
    subject: input.subject,
    html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${input.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</div>`,
  });

  if (!sendResult.ok) {
    return { ok: false as const, error: sendResult.error ?? "Email send failed." };
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "email_sent",
      payload: {
        audience: input.audience,
        to: input.to,
        subject: input.subject,
        sentAt: new Date().toISOString(),
      },
    });
  }

  return { ok: true as const };
}

export async function saveDealOutreachExecution(input: SaveDealOutreachExecutionInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const nextAction =
    input.nextStep.trim()
    || `${input.audience} outreach logged for ${input.recipient}. Review response posture and continue follow-up.`;

  const [conversationUpdate, logInsert] = await Promise.all([
    supabase
      .from("seller_conversations")
      .update({
        next_action: nextAction,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "outreach_execution_logged",
      payload: {
        audience: input.audience,
        channel: input.channel,
        recipient: input.recipient,
        status: input.status,
        outcome: input.outcome,
        nextStep: nextAction,
        notes: input.notes,
        loggedAt: new Date().toISOString(),
      },
    }),
  ]);

  const error = conversationUpdate.error?.message || logInsert.error?.message;
  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const };
}

export async function saveDealCloseout(input: SaveDealCloseoutInput) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  }

  const closeoutSummary =
    `${input.outcome} / ${input.buyerName || "Buyer TBD"} / fee ${formatCurrency(clampMoney(input.assignmentFeeCollected))} / close ${input.closedAt || "TBD"}`;

  const [leadUpdate, conversationUpdate, contractUpdate, logInsert] = await Promise.all([
    supabase
      .from("deal_leads")
      .update({
        status: "Closed",
        recommended_next_action: closeoutSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.dealId),
    supabase
      .from("seller_conversations")
      .update({
        next_action: `Closeout recorded: ${closeoutSummary}`,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase
      .from("contracts")
      .update({
        assignment_status: input.outcome,
        updated_at: new Date().toISOString(),
      })
      .eq("lead_id", input.dealId),
    supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "deal_closeout_recorded",
      payload: {
        outcome: input.outcome,
        closedAt: input.closedAt,
        assignmentFeeCollected: clampMoney(input.assignmentFeeCollected),
        buyerName: input.buyerName,
        notes: input.notes,
        recordedAt: new Date().toISOString(),
      },
    }),
  ]);

  const error =
    leadUpdate.error?.message
    || conversationUpdate.error?.message
    || contractUpdate.error?.message
    || logInsert.error?.message;

  if (error) {
    return { ok: false as const, error };
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

  const lead = leads.find((item) => item.id === dealId) ?? null;
  if (!lead) return null;

  const sellerSignal = findSellerSignalForLead(lead, sellerSignals);
  const relatedBuyerSignals = rankBuyerSignalsForLead(lead, buyerSignals, 6);
  let contractDraft = buildContractDrafts([lead], sellerSignals, relatedBuyerSignals).find(
    (item) => item.dealId === dealId,
  ) ?? null;
  let underwriting = buildUnderwritingSnapshot(lead, null);
  let sellerContact = buildSellerContactProfile(lead, sellerSignal);
  let sellerContactWorkflow = buildSellerContactWorkflow(lead, sellerContact);
  let sellerOutreach = buildSellerOutreach(lead, sellerSignal, sellerContact, contractDraft);
  let relatedDrafts = drafts
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
  let outreachExecutions: DealEngineDealDetail["outreachExecutions"] = [];
  let uploadedDocuments: DealEngineDealDetail["uploadedDocuments"] = [];
  let investorResponses: DealEngineDealDetail["investorResponses"] = [];
  let operatorTasks: DealEngineDealDetail["operatorTasks"] = [];
  let activityFeed: DealEngineDealDetail["activityFeed"] = [];
  let closeout: DealEngineDealDetail["closeout"] = null;
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
    packet = enrichPacketWithSellerContactStatus(packet, sellerContact);
    await syncDealBuyerMatches(supabase, lead, relatedBuyerSignals).catch(() => null);
    await ensureDealExecutionScaffold(supabase, lead, contractDraft, packet, room).catch(() => null);

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
      packet = enrichPacketWithSellerContactStatus(packet, sellerContact);
      room = buildFallbackRoom(lead, packet);
    }

    const { data: analysisData } = await supabase
      .from("deal_analysis")
      .select("estimated_arv,purchase_price_target,seller_asking_price,repair_estimate,closing_costs,holding_costs,buyer_profit_target,assignment_fee_target,rental_estimate,flip_estimate,wholesale_spread,maximum_allowable_offer,deal_rating")
      .eq("lead_id", dealId)
      .maybeSingle();
    underwriting = buildUnderwritingSnapshot(lead, analysisData as DealAnalysisRow | null);
    if (contractDraft) {
      contractDraft = {
        ...contractDraft,
        offerWindow:
          underwriting.maximumAllowableOffer > 0
            ? deriveOfferWindowFromNumbers(
                underwriting.maximumAllowableOffer,
                underwriting.assignmentFeeTarget,
              )
            : contractDraft.offerWindow,
      };
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
      if (contractDraft) {
        contractDraft = {
          ...contractDraft,
          contractType: liveContract.assignment_status?.trim() || contractDraft.contractType,
          earnestMoney:
            liveContract.earnest_money_deposit != null
              ? formatCurrency(liveContract.earnest_money_deposit)
              : contractDraft.earnestMoney,
        };
      }
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
      .in("action_type", ["investor_interest", "investor_follow_up", "stage_update", "contract_update", "packet_update", "buyer_draft_created", "buyer_search_launched", "seller_draft_saved", "operator_task", "coordination_update", "analysis_update", "outreach_execution_logged", "deal_closeout_recorded", "document_uploaded", "email_sent"])
      .order("created_at", { ascending: false });
    if (dispositionData?.length) {
      const logs = dispositionData as DispositionLogRow[];
      sellerDrafts = parseSellerDrafts(logs);
      outreachExecutions = parseOutreachExecutions(logs);
      uploadedDocuments = parseUploadedDocuments(logs);
      investorResponses = parseDispositionLogs(logs);
      operatorTasks = parseOperatorTasks(logs);
      activityFeed = buildActivityFeed(logs);
      closeout = parseCloseout(logs);
      const buyerDraftLogs = parseBuyerDraftsFromLogs(logs);
      if (buyerDraftLogs.length) {
        relatedDrafts = [
          ...buyerDraftLogs,
          ...relatedDrafts.filter((draft) => buyerDraftLogs.every((loggedDraft) => loggedDraft.subject !== draft.subject || loggedDraft.buyerName !== draft.buyerName)),
        ].slice(0, 8);
      }
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
      coordination = mergeUploadedDocumentsIntoCoordination(coordination, uploadedDocuments);
    }
  }

  if (!operatorTasks.some((task) => /seller phone|skip trace|first-touch/i.test(task.title))) {
    operatorTasks = [buildDefaultContactOperatorTask(lead, sellerContact), ...operatorTasks];
  }

  return {
    lead,
    underwriting,
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
    outreachExecutions,
    uploadedDocuments,
    investorResponses,
    operatorTasks,
    activityFeed,
    closeout,
    automationWorkflow: buildDealAutomationWorkflow({
      lead,
      underwriting,
      sellerContact,
      buyerSignals: relatedBuyerSignals.length ? relatedBuyerSignals : buyerSignals.slice(0, 4),
      coordination,
      packet,
      uploadedDocuments,
    }),
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
  const [leads, sellerSignals, buyerSignals, persistence] = await Promise.all([
    listDealEngineLeads(6),
    listDealEngineSellerSignals(4),
    listDealEngineBuyerSignals(4),
    getDealEnginePersistenceStatus(),
  ]);
  const liveCount = leads.length;
  const offerReadyCount = leads.filter((lead) => lead.status === "Offer Ready").length;
  const negotiatingCount = leads.filter((lead) => lead.status === "Negotiating").length;

  return {
    env,
    persistence,
    leads,
    metrics: buildMetrics(leads),
    heroSignals: [
      persistence.ready
        ? "Deal Engine live data path online"
        : persistence.mode === "schema-missing"
          ? "Deal Engine schema still needs to be applied"
          : `Awaiting ${env.missing.join(" + ")}`,
      liveCount ? `${liveCount} live deals in command` : "No live Deal Engine records found",
      offerReadyCount || negotiatingCount
        ? `${offerReadyCount} offer-ready / ${negotiatingCount} negotiating`
        : "No live deals are active in analysis, offer, or negotiation yet",
    ],
    stageBoard: buildStageBoard(leads),
    sellerSignals,
    buyerSignals,
    contractDrafts: buildContractDrafts(leads, sellerSignals, buyerSignals),
  };
}

function inferContactConfidence(detail: DealEngineDealDetail, sellerLead: SellerLeadView | null) {
  if (typeof sellerLead?.contactConfidenceScore === "number") {
    return Math.max(0, Math.min(100, sellerLead.contactConfidenceScore));
  }

  if (/verified|connected|ready/i.test(detail.sellerContact.phoneStatus)) return 82;
  if (/skip trace needed|queued|missing/i.test(detail.sellerContact.phoneStatus)) return 42;
  if (/dnc|blocked/i.test(detail.sellerContact.phoneStatus)) return 18;
  return 58;
}

function deriveSellerPainPoint(detail: DealEngineDealDetail, sellerLead: SellerLeadView | null) {
  const reasons = sellerLead?.reasons ?? [];
  const sourceType = (sellerLead?.sourceType ?? "").replaceAll("_", " ");

  if (reasons.some((reason) => /probate/i.test(reason)) || /probate/i.test(sourceType)) {
    return "The property may feel more like a burden than an asset, and the seller likely values speed, simplicity, and low coordination.";
  }
  if (reasons.some((reason) => /tax delinquent/i.test(reason)) || /tax/i.test(sourceType)) {
    return "Tax pressure may be forcing the seller to prioritize a quick resolution over squeezing for full retail pricing.";
  }
  if (reasons.some((reason) => /vacant|code violation|foreclosure/i.test(reason))) {
    return "The property condition or compliance drag is likely creating emotional and financial fatigue, which supports a certainty-first offer angle.";
  }
  if (detail.lead.motivationScore >= 80) {
    return "The seller profile shows enough urgency that convenience, timeline certainty, and no-repair relief should outperform a price-only conversation.";
  }
  return "The seller may still need conviction, so the best angle is reducing friction, clarifying timing, and proving the deal can close cleanly.";
}

function deriveNegotiationAngle(detail: DealEngineDealDetail, spread: number, contactConfidence: number) {
  if (detail.underwriting.missingInputs.length) {
    return "Lead with discovery, not price. Tighten underwriting inputs first so the offer anchor is grounded and defensible.";
  }
  if (contactConfidence < 60) {
    return "Do not over-negotiate before contact posture is verified. Confirm the real decision maker and then frame the offer around certainty and ease.";
  }
  if (spread >= 40000) {
    return "Anchor on a clean-close convenience story first, then hold firm on a disciplined investor number backed by repair load and timeline relief.";
  }
  if (spread >= 20000) {
    return "Use a narrow, evidence-backed range. The conversation should emphasize speed and reduced prep work more than aggressive discounting.";
  }
  return "Stay cautious. Position the offer as a low-friction off-market option and avoid overcommitting before spread improves.";
}

function deriveBuyerFitSummary(detail: DealEngineDealDetail, spread: number) {
  if (!detail.buyerSignals.length) {
    return `No live buyer shortlist is attached yet. This lane still needs a fresh Buyer Engine run for ${detail.lead.county} County before broad disposition.`;
  }

  const top = detail.buyerSignals
    .slice(0, 3)
    .map((signal) => `${signal.buyerName} (${signal.propertyType}, score ${signal.score})`);
  const strength =
    spread >= 40000
      ? "The spread supports an aggressive flipper-oriented release."
      : spread >= 20000
        ? "The spread supports a focused shortlist rather than a wide blast."
        : "Buyer fit exists, but the spread suggests a narrow release to the most aligned operators only.";

  return `${strength} Current best-fit buyers: ${top.join("; ")}.`;
}

function deriveDispositionStrategy(detail: DealEngineDealDetail, spread: number) {
  if (!detail.buyerSignals.length) {
    return "Keep this inside internal command until Buyer Engine refreshes the shortlist, then build a controlled packet release.";
  }
  if (spread >= 40000) {
    return "Prepare a premium investor packet, release to the top buyer cohort first, and escalate to a broader county lane only if early interest is soft.";
  }
  if (spread >= 20000) {
    return "Run a selective disposition push to the top local buyers, keeping the packet tight and the walkthrough cadence controlled.";
  }
  return "Use a quiet, relationship-driven disposition path and avoid a broad blast until the margin improves or a niche buyer fit is confirmed.";
}

function deriveFollowUpRecommendation(detail: DealEngineDealDetail, contactConfidence: number) {
  if (contactConfidence < 60) {
    return "Refresh Nexus contact verification first, then schedule the first seller touch within the same operating block.";
  }
  if (detail.lead.status === "Needs Analysis" || detail.underwriting.missingInputs.length) {
    return "Complete underwriting and re-open the seller within 24 hours with a clear range, not a vague teaser.";
  }
  if (!detail.buyerSignals.length) {
    return "Launch Buyer Engine after the seller posture is stable, then refresh the packet and line up top-fit buyers.";
  }
  return "Follow up with the seller inside 24 hours, keep the negotiation lane warm, and prepare the first buyer packet release immediately after terms stabilize.";
}

function buildRuleBasedCommanderInsight(
  detail: DealEngineDealDetail,
  sellerLead: SellerLeadView | null,
): DealCommanderInsight {
  const contactConfidence = inferContactConfidence(detail, sellerLead);
  const missingCount = detail.underwriting.missingInputs.length;
  const estimatedMao = Math.max(0, Math.round(detail.underwriting.maximumAllowableOffer || detail.underwriting.purchasePriceTarget || 0));
  const offerRangeHigh = estimatedMao;
  const offerRangeLow = Math.max(
    0,
    Math.round(
      offerRangeHigh
        ? offerRangeHigh - Math.max(detail.underwriting.assignmentFeeTarget * 0.5, 5000)
        : detail.underwriting.purchasePriceTarget * 0.92,
    ),
  );
  const estimatedArv = Math.max(0, Math.round(detail.underwriting.estimatedArv || 0));
  const spread =
    detail.underwriting.wholesaleSpread > 0
      ? Math.round(detail.underwriting.wholesaleSpread)
      : Math.max(
          0,
          estimatedArv
            - detail.underwriting.repairEstimate
            - detail.underwriting.closingCosts
            - detail.underwriting.holdingCosts
            - Math.max(detail.underwriting.sellerAskingPrice || detail.underwriting.purchasePriceTarget, offerRangeHigh)
            - detail.underwriting.assignmentFeeTarget,
        );
  const spreadRatio = estimatedArv > 0 ? spread / estimatedArv : 0;
  const buyerFitCount = detail.buyerSignals.length;

  let priorityScore = 0;
  priorityScore += detail.lead.motivationScore >= 80 ? 28 : detail.lead.motivationScore >= 60 ? 18 : 8;
  priorityScore += spreadRatio >= 0.18 ? 26 : spreadRatio >= 0.1 ? 16 : spreadRatio >= 0.05 ? 8 : 0;
  priorityScore += contactConfidence >= 70 ? 18 : contactConfidence >= 55 ? 10 : 2;
  priorityScore += buyerFitCount >= 3 ? 16 : buyerFitCount >= 1 ? 9 : 0;
  priorityScore += missingCount === 0 ? 12 : missingCount <= 2 ? 4 : -6;

  const priority: DealCommanderInsight["priority"] =
    priorityScore >= 70 ? "High" : priorityScore >= 42 ? "Medium" : "Low";

  const completenessScore = Math.max(0, 100 - missingCount * 12);
  const confidenceScore = Math.max(
    18,
    Math.min(
      98,
      Math.round(
        completenessScore * 0.35
          + Math.min(detail.lead.motivationScore, 100) * 0.2
          + Math.min(contactConfidence, 100) * 0.2
          + Math.min(buyerFitCount * 18, 100) * 0.15
          + Math.min(spreadRatio * 240, 100) * 0.1,
      ),
    ),
  );

  const riskWarnings: string[] = [];
  if (!estimatedArv) riskWarnings.push("ARV is still missing, so the pricing lane is not fully anchored.");
  if (detail.underwriting.repairEstimate <= 0) riskWarnings.push("Repair estimate is missing or too soft, which can distort the true spread.");
  if (contactConfidence < 60) riskWarnings.push("Seller contact confidence is weak, so negotiation timing may be premature.");
  if (!buyerFitCount) riskWarnings.push("No live buyer fit is attached yet, so disposition confidence is limited.");
  if (spreadRatio < 0.08) riskWarnings.push("The current spread looks thin for a clean wholesale release.");
  if (/dead|blocked/i.test(detail.lead.status)) riskWarnings.push("The current deal stage suggests the lane may already be cooling.");

  const suggestedNextAction =
    missingCount > 0
      ? `Finish underwriting inputs first: ${detail.underwriting.missingInputs.slice(0, 2).join(", ")}. Once the numbers are tight, reopen the seller lane with a disciplined range.`
      : contactConfidence < 60
        ? "Refresh Nexus contact posture and verify the best decision-maker line before pushing into a pricing conversation."
        : !buyerFitCount
          ? `Launch Buyer Engine for ${detail.lead.county} County after the seller lane is stabilized so the packet has a real shortlist behind it.`
          : spreadRatio >= 0.12
            ? "Move into live negotiation with a certainty-first range, then line up the first buyer packet release as soon as the seller soft-commits."
            : "Keep the deal warm, tighten the terms, and avoid forcing a contract until either spread or buyer fit strengthens.";

  return {
    priority,
    confidenceScore,
    suggestedNextAction,
    estimatedMao,
    offerRangeLow,
    offerRangeHigh,
    negotiationAngle: deriveNegotiationAngle(detail, spread, contactConfidence),
    sellerPainPointHypothesis: deriveSellerPainPoint(detail, sellerLead),
    buyerFitSummary: deriveBuyerFitSummary(detail, spread),
    riskWarnings,
    dispositionStrategy: deriveDispositionStrategy(detail, spread),
    followUpRecommendation: deriveFollowUpRecommendation(detail, contactConfidence),
    generationMode: "rules",
    generatedAt: new Date().toISOString(),
  };
}

async function maybeEnhanceCommanderInsightWithAi(
  detail: DealEngineDealDetail,
  fallbackInsight: DealCommanderInsight,
  sellerLead: SellerLeadView | null,
): Promise<DealCommanderInsight> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallbackInsight;

  const model = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini";
  const prompt = `You are Blackspire's AI Deal Commander. Refine the fallback commander insight for this wholesale real-estate deal and return valid JSON only.

Return exactly this shape:
{
  "priority": "High" | "Medium" | "Low",
  "confidenceScore": number,
  "suggestedNextAction": string,
  "estimatedMao": number,
  "offerRangeLow": number,
  "offerRangeHigh": number,
  "negotiationAngle": string,
  "sellerPainPointHypothesis": string,
  "buyerFitSummary": string,
  "riskWarnings": string[],
  "dispositionStrategy": string,
  "followUpRecommendation": string
}

Rules:
- Stay grounded in the provided deal data.
- Keep the tone tactical, operator-facing, and concise.
- Do not invent buyers, valuations, or contact data that are not supported.

Deal data:
- Deal id: ${detail.lead.id}
- Property: ${detail.lead.propertyAddress}
- County: ${detail.lead.county}
- Stage: ${detail.lead.status}
- Motivation score: ${detail.lead.motivationScore}
- Next action currently stored: ${detail.lead.nextAction}
- Seller contact posture: ${detail.sellerContact.phoneStatus}
- Seller contact notes: ${detail.sellerContact.contactEnrichmentNotes}
- Underwriting ARV: ${detail.underwriting.estimatedArv}
- Seller asking price: ${detail.underwriting.sellerAskingPrice}
- Repair estimate: ${detail.underwriting.repairEstimate}
- Closing costs: ${detail.underwriting.closingCosts}
- Holding costs: ${detail.underwriting.holdingCosts}
- Buyer profit target: ${detail.underwriting.buyerProfitTarget}
- Assignment fee target: ${detail.underwriting.assignmentFeeTarget}
- Purchase price target: ${detail.underwriting.purchasePriceTarget}
- Maximum allowable offer: ${detail.underwriting.maximumAllowableOffer}
- Wholesale spread: ${detail.underwriting.wholesaleSpread}
- Missing inputs: ${detail.underwriting.missingInputs.join(", ") || "none"}
- Buyer signals: ${detail.buyerSignals.map((signal) => `${signal.buyerName} / ${signal.propertyType} / ${signal.score}`).join("; ") || "none"}
- Seller lead reasons: ${sellerLead?.reasons.join("; ") || "none"}

Fallback insight:
${JSON.stringify(fallbackInsight)}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(18_000),
    });

    if (!response.ok) return fallbackInsight;

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return fallbackInsight;

    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (!objectMatch) return fallbackInsight;

    const parsed = JSON.parse(objectMatch[0]) as Partial<DealCommanderInsight> & {
      riskWarnings?: unknown;
    };

    return {
      priority:
        parsed.priority === "High" || parsed.priority === "Medium" || parsed.priority === "Low"
          ? parsed.priority
          : fallbackInsight.priority,
      confidenceScore: Math.max(1, Math.min(100, Math.round(Number(parsed.confidenceScore ?? fallbackInsight.confidenceScore)))),
      suggestedNextAction: String(parsed.suggestedNextAction ?? fallbackInsight.suggestedNextAction),
      estimatedMao: Math.max(0, Math.round(Number(parsed.estimatedMao ?? fallbackInsight.estimatedMao))),
      offerRangeLow: Math.max(0, Math.round(Number(parsed.offerRangeLow ?? fallbackInsight.offerRangeLow))),
      offerRangeHigh: Math.max(0, Math.round(Number(parsed.offerRangeHigh ?? fallbackInsight.offerRangeHigh))),
      negotiationAngle: String(parsed.negotiationAngle ?? fallbackInsight.negotiationAngle),
      sellerPainPointHypothesis: String(parsed.sellerPainPointHypothesis ?? fallbackInsight.sellerPainPointHypothesis),
      buyerFitSummary: String(parsed.buyerFitSummary ?? fallbackInsight.buyerFitSummary),
      riskWarnings: Array.isArray(parsed.riskWarnings)
        ? parsed.riskWarnings.map((item) => String(item)).filter(Boolean).slice(0, 6)
        : fallbackInsight.riskWarnings,
      dispositionStrategy: String(parsed.dispositionStrategy ?? fallbackInsight.dispositionStrategy),
      followUpRecommendation: String(parsed.followUpRecommendation ?? fallbackInsight.followUpRecommendation),
      generationMode: "ai",
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return fallbackInsight;
  }
}

export async function generateDealCommanderInsight(dealId: string): Promise<DealCommanderInsight | null> {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;

  const sellerLeads = await listSellerLeads().catch(() => []);
  const sellerLead =
    sellerLeads.find((lead) => lead.relatedDealId === dealId)
    ?? sellerLeads.find(
      (lead) =>
        lead.propertyAddress.trim().toLowerCase() === detail.lead.propertyAddress.trim().toLowerCase()
        || lead.ownerName.trim().toLowerCase() === detail.lead.ownerName.trim().toLowerCase(),
    )
    ?? null;

  const fallbackInsight = buildRuleBasedCommanderInsight(detail, sellerLead);
  return maybeEnhanceCommanderInsightWithAi(detail, fallbackInsight, sellerLead);
}

function isMissingDealTransactionTableError(error: { message?: string | null } | null | undefined) {
  if (!error?.message) return false;
  return /deal_contract_drafts|deal_signature_packets|deal_title_checklist_items|deal_emd_trackers|deal_assignment_fee_trackers|deal_closing_timeline_events|deal_documents/i.test(error.message);
}

const DEFAULT_TITLE_CHECKLIST = [
  ["title_company_selected", "Title company selected"],
  ["escrow_officer_added", "Escrow officer/contact added"],
  ["purchase_agreement_sent", "Purchase agreement sent"],
  ["emd_received_by_title", "EMD received by title"],
  ["title_search_started", "Title search started"],
  ["title_issues_found", "Title issues found"],
  ["title_issues_cleared", "Title issues cleared"],
  ["assignment_agreement_sent", "Assignment agreement sent"],
  ["buyer_funds_verified", "Buyer funds verified"],
  ["closing_statement_received", "Closing statement received"],
  ["closing_scheduled", "Closing scheduled"],
  ["seller_signed", "Seller signed"],
  ["buyer_signed", "Buyer signed"],
  ["assignment_fee_confirmed", "Assignment fee confirmed"],
  ["deal_closed", "Deal closed"],
] as const;

const DEFAULT_TIMELINE = [
  ["seller_lead_created", "Seller lead created"],
  ["seller_contacted", "Seller contacted"],
  ["contract_signed", "Contract signed"],
  ["emd_due", "EMD due"],
  ["emd_received", "EMD received"],
  ["buyer_packet_created", "Buyer packet created"],
  ["buyer_assigned", "Buyer assigned"],
  ["assignment_signed", "Assignment signed"],
  ["title_search_started", "Title search started"],
  ["title_cleared", "Title cleared"],
  ["closing_scheduled", "Closing scheduled"],
  ["closing_completed", "Closing completed"],
  ["assignment_fee_paid", "Assignment fee paid"],
] as const;

function buildContractDisclaimer() {
  return "Blackspire-generated draft for operational prep only. Review with a licensed attorney or title company before use.";
}

function sanitizeDraftType(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function toContractTemplateRecord(template: ContractTemplateRecord | ContractTemplateRow): DealContractTemplateRecord {
  if ("templateKey" in template) {
    return {
      id: template.id,
      templateKey: template.templateKey,
      type: template.type,
      name: template.name,
      intendedPurpose: template.intendedPurpose,
      sourceName: template.sourceName,
      sourceUrl: template.sourceUrl,
      licenseStatus: template.licenseStatus,
      approvalStatus: template.approvalStatus,
      state: template.state,
      version: template.version,
      requiredFields: template.requiredFields,
      optionalFields: template.optionalFields,
      variableMap: template.variableMap,
      storagePath: template.storagePath,
      notes: template.notes,
      requestedUse: template.requestedUse,
    };
  }

  return {
    id: template.id,
    templateKey: template.template_key,
    type: template.template_type,
    name: template.name,
    intendedPurpose: template.intended_purpose,
    sourceName: template.source_name,
    sourceUrl: template.source_url,
    licenseStatus: (template.license_status as ContractTemplateLicenseStatus) || "unknown",
    approvalStatus: (template.approval_status as ContractTemplateApprovalStatus) || "reference_only",
    state: template.state,
    version: template.version,
    requiredFields: template.required_fields ?? [],
    optionalFields: template.optional_fields ?? [],
    variableMap: template.variable_map ?? {},
    storagePath: template.storage_path,
    notes: template.notes ?? "",
    requestedUse: template.template_type,
  };
}

function formatContractFieldValue(field: string, value: unknown) {
  if (Array.isArray(value)) {
    return value.length ? value.map((entry) => String(entry)).join(", ") : "";
  }
  if (typeof value === "number") {
    const currencyFields = /(price|fee|deposit|amount|cost)/i;
    return currencyFields.test(field) ? formatCurrency(value) : String(value);
  }
  return String(value ?? "").trim();
}

function dealFieldPayload(detail: DealEngineDealDetail, emd: DealEmdTrackerRecord | null, assignment: DealAssignmentFeeTrackerRecord | null, documents: DealDocumentVaultRecord[]) {
  const terms = deriveContractTerms(detail);
  const fallbackClosingDate = inferClosingDate(detail);
  const inspectionDeadline = detail.coordination.inspectionEndsOn || inferInspectionPeriod(detail);
  const originalPurchasePrice = assignment?.sellerContractPrice || terms.purchasePrice || 0;
  const assignmentPrice = assignment?.buyerAssignmentPrice || (originalPurchasePrice + (assignment?.assignmentFee || terms.assignmentFee || 0));
  const assignmentFee = assignment?.assignmentFee || terms.assignmentFee || 0;
  const emdAmount = emd?.emdAmount || terms.earnestMoney || 0;

  return {
    deal_id: detail.lead.id,
    seller_name: detail.sellerContact.ownerName || detail.lead.ownerName || "",
    buyer_or_acquisition_entity_name: "Blackspire Helix Group or assigns",
    assignor_name: "Blackspire Helix Group",
    assignee_name: inferBuyerOrAssigneeName(detail),
    original_seller_name: detail.sellerContact.ownerName || detail.lead.ownerName || "",
    property_address: detail.lead.propertyAddress || "",
    purchase_price: terms.purchasePrice,
    original_purchase_price: originalPurchasePrice,
    assignment_price: assignmentPrice,
    assignment_fee: assignmentFee,
    earnest_money_deposit: emdAmount,
    emd_amount: emdAmount,
    emd_holder: emd?.emdHolder || detail.coordination.titleCompany || "",
    emd_holder_type: emd?.emdHolderType || "title_company",
    emd_payment_method: emd?.emdPaymentMethod || "",
    emd_received_date: emd?.emdDueDate || "",
    receipt_reference: emd?.emdReceiptUrl || "",
    closing_date: fallbackClosingDate,
    original_closing_date: fallbackClosingDate,
    new_closing_date: fallbackClosingDate,
    reason_for_extension: detail.coordination.coordinationNotes || "",
    inspection_period: inferInspectionPeriod(detail),
    inspection_deadline: inspectionDeadline,
    original_contract_date: detail.activityFeed.at(-1)?.timestamp?.slice(0, 10) || "",
    assignment_allowed_language: "Assignment rights must match the underlying purchase agreement and any seller acknowledgment requirements.",
    title_company: detail.coordination.titleCompany || "",
    special_terms: detail.coordination.coordinationNotes || detail.packet.contactInstructions || "",
    acknowledgment_language: "Buyer acknowledges the assignment fee and confirms receipt of this disclosure before funding or closing.",
    end_buyer_name: inferBuyerOrAssigneeName(detail),
    escrow_officer_name: detail.coordination.titleOfficer || "",
    escrow_officer_email: "",
    attached_documents: documents.length ? documents.map((document) => `${document.category}: ${document.fileName}`) : [],
  } satisfies Record<string, unknown>;
}

async function readTemplateStorage(template: DealContractTemplateRecord) {
  if (!template.storagePath) return "";
  const templatePath = path.join(process.cwd(), "src", "templates", "contracts", template.storagePath);
  return readFile(templatePath, "utf8");
}

function fillTemplateVariables(body: string, values: Record<string, unknown>) {
  return body.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_, key: string) => formatContractFieldValue(key, values[key]));
}

async function writeContractAuditLog(input: {
  dealId: string;
  templateId: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { error } = await supabase.from("contract_generation_audit_logs").insert({
    deal_id: input.dealId,
    template_id: input.templateId,
    action: input.action,
    metadata: input.metadata ?? {},
  });
  if (error && !isMissingDealTransactionTableError(error)) {
    throw new Error(error.message);
  }
}

async function syncContractTemplateRegistry(supabase: SupabaseClient) {
  const payload = CONTRACT_TEMPLATE_REGISTRY.map((template) => ({
    template_key: template.templateKey,
    template_type: template.type,
    name: template.name,
    intended_purpose: template.intendedPurpose,
    source_name: template.sourceName,
    source_url: template.sourceUrl,
    license_status: template.licenseStatus,
    approval_status: template.approvalStatus,
    state: template.state,
    version: template.version,
    required_fields: template.requiredFields,
    optional_fields: template.optionalFields,
    variable_map: template.variableMap,
    storage_path: template.storagePath,
    notes: template.notes,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("contract_templates").upsert(payload, { onConflict: "template_key" });
  if (error && !isMissingDealTransactionTableError(error)) {
    throw new Error(error.message);
  }
}

function mapTemplateCategory(templateType: string) {
  if (templateType === "purchase_agreement") return "purchase_agreement";
  if (templateType === "assignment_agreement") return "assignment_agreement";
  if (templateType === "assignment_addendum") return "addendum";
  if (templateType === "inspection_addendum") return "addendum";
  if (templateType === "closing_extension_addendum") return "addendum";
  if (templateType === "emd_receipt") return "emd_receipt";
  if (templateType === "buyer_assignment_fee_disclosure") return "assignment_disclosure";
  if (templateType === "title_company_submission_package") return "title_package";
  return "other";
}

function canPrepareTemplateForSignature(validation: DealContractTemplateValidation, draft: DealContractDraftRecord | null) {
  return validation.purposeValid
    && validation.missingFields.length === 0
    && draft?.legalDisclaimerAcknowledged
    && validation.template.approvalStatus !== "reference_only";
}

function buildTemplateSafetyLines(template: DealContractTemplateRecord) {
  if (template.approvalStatus === "attorney_approved") {
    return [
      "Attorney-approved source template integrated.",
      "Confirm all deal-specific names, dates, numbers, and title details before signature.",
      "Generated documents still require operator review before release.",
    ];
  }

  if (template.approvalStatus === "attorney_review_required") {
    return [
      "Attorney review required.",
      "Do not send for signature until approved.",
      "Generated documents are not legal advice.",
    ];
  }

  return [
    "Reference template only.",
    "Attorney review required.",
    "Do not send for signature until approved.",
    "Generated documents are not legal advice.",
  ];
}

function inferBuyerOrAssigneeName(detail: DealEngineDealDetail) {
  return detail.closeout?.buyerName?.trim()
    || detail.investorResponses[0]?.investorName?.trim()
    || detail.buyerSignals[0]?.buyerName?.trim()
    || "Assignee / Buyer TBD";
}

function inferClosingDate(detail: DealEngineDealDetail) {
  return detail.coordination.closingDate || detail.closeout?.closedAt || "TBD";
}

function inferInspectionPeriod(detail: DealEngineDealDetail) {
  return detail.coordination.inspectionEndsOn || detail.contractDraft?.earnestMoney || "14 days";
}

function deriveContractTerms(detail: DealEngineDealDetail) {
  const purchasePrice =
    detail.underwriting.purchasePriceTarget
    || detail.underwriting.maximumAllowableOffer
    || Number(detail.lead.mao.replace(/[^0-9.-]/g, "")) || 0;
  const assignmentFee =
    detail.underwriting.assignmentFeeTarget
    || Number(detail.lead.assignmentFee.replace(/[^0-9.-]/g, "")) || 0;
  const earnestMoney =
    Number(detail.contractDraft?.earnestMoney.replace(/[^0-9.-]/g, "")) || 0;

  return {
    sellerName: detail.sellerContact.ownerName || detail.lead.ownerName,
    buyerName: inferBuyerOrAssigneeName(detail),
    propertyAddress: detail.lead.propertyAddress,
    purchasePrice,
    assignmentFee,
    earnestMoney,
    closingDate: inferClosingDate(detail),
    titleCompany: detail.coordination.titleCompany || "Title Company TBD",
    inspectionPeriod: detail.coordination.inspectionEndsOn || "14 days",
    specialTerms: detail.coordination.coordinationNotes || detail.packet.contactInstructions || "No additional special terms entered yet.",
  };
}

function buildPurchaseAgreementText(detail: DealEngineDealDetail) {
  const terms = deriveContractTerms(detail);
  return [
    "PURCHASE AGREEMENT DRAFT",
    buildContractDisclaimer(),
    "",
    `Seller: ${terms.sellerName}`,
    `Buyer: Blackspire Helix Group or assigns`,
    `Property: ${terms.propertyAddress}`,
    `Purchase Price: ${formatCurrency(terms.purchasePrice)}`,
    `Earnest Money Deposit: ${formatCurrency(terms.earnestMoney)}`,
    `Inspection Period: ${terms.inspectionPeriod}`,
    `Closing Date: ${terms.closingDate}`,
    `Title Company: ${terms.titleCompany}`,
    "",
    "Special Terms:",
    terms.specialTerms,
    "",
    "Operational Notes:",
    `- Recommended seller angle: ${detail.lead.nextAction}`,
    `- Underwriting posture: ${detail.underwriting.dealRating}`,
    `- Contract status should not be treated as legal advice.`,
  ].join("\n");
}

function buildAssignmentAgreementText(detail: DealEngineDealDetail) {
  const terms = deriveContractTerms(detail);
  return [
    "ASSIGNMENT AGREEMENT DRAFT",
    buildContractDisclaimer(),
    "",
    `Assignor: Blackspire Helix Group`,
    `Assignee / Buyer: ${terms.buyerName}`,
    `Underlying Property: ${terms.propertyAddress}`,
    `Seller Contract Price: ${formatCurrency(terms.purchasePrice)}`,
    `Assignment Fee: ${formatCurrency(terms.assignmentFee)}`,
    `Closing Date: ${terms.closingDate}`,
    `Title Company: ${terms.titleCompany}`,
    "",
    "Notes:",
    `- Buyer fit summary: ${detail.buyerSignals[0]?.outreachAngle ?? "Buyer lane still being refined."}`,
    `- Contact instructions: ${detail.packet.contactInstructions}`,
  ].join("\n");
}

function buildAddendumText(detail: DealEngineDealDetail, addendumType: string) {
  const terms = deriveContractTerms(detail);
  const readableType = addendumType.replaceAll("_", " ");
  return [
    `${readableType.toUpperCase()} DRAFT`,
    buildContractDisclaimer(),
    "",
    `Property: ${terms.propertyAddress}`,
    `Seller: ${terms.sellerName}`,
    `Buyer / Assignee: ${terms.buyerName}`,
    `Closing Date: ${terms.closingDate}`,
    "",
    "Addendum Purpose:",
    `This addendum documents the ${readableType} for the live deal lane inside Blackspire Deal Engine.`,
    "",
    "Working Terms:",
    terms.specialTerms,
  ].join("\n");
}

function toContractDraftRecord(row: DealContractDraftRow): DealContractDraftRecord {
  return {
    id: row.id,
    draftType: row.draft_type,
    templateId: row.template_id ?? null,
    templateType: row.template_type ?? row.draft_type,
    status: row.status ?? "draft",
    title: row.title,
    body: row.generated_body ?? row.body,
    specialTerms: row.special_terms ?? "",
    generatedPdfUrl: row.generated_pdf_url ?? "",
    editablePayload: row.editable_payload ?? {},
    legalDisclaimerAcknowledged: Boolean(row.legal_disclaimer_acknowledged),
    updatedAt: row.updated_at,
  };
}

function toSignaturePacketRecord(row: DealSignaturePacketRow | null): DealSignaturePacketRecord {
  return {
    id: row?.id ?? null,
    signatureStatus: row?.signature_status ?? "draft",
    sentForSignatureAt: row?.sent_for_signature_at ?? null,
    signedBySellerAt: row?.signed_by_seller_at ?? null,
    signedByBuyerAt: row?.signed_by_buyer_at ?? null,
    signatureProvider: row?.signature_provider ?? "",
    signaturePacketUrl: row?.signature_packet_url ?? "",
    signerEmail: row?.signer_email ?? "",
    signerRole: row?.signer_role ?? "",
    availableProviders: ["DocuSign", "PandaDoc", "Dropbox Sign"],
  };
}

function toTitleChecklistItemRecord(row: DealTitleChecklistItemRow): DealTitleChecklistItemRecord {
  const status = row.status === "complete" || row.status === "blocked" ? row.status : "pending";
  return {
    id: row.id,
    itemKey: row.item_key,
    label: row.label,
    status,
    notes: row.notes ?? "",
    dueDate: row.due_date ?? "",
    assignedOwner: row.assigned_owner ?? "",
    updatedAt: row.updated_at,
  };
}

function computeEmdStatusTone(status: DealEmdTrackerRecord["emdStatus"]) {
  if (status === "received") return "good" as const;
  if (status === "overdue") return "bad" as const;
  if (status === "pending" || status === "submitted") return "warn" as const;
  return "neutral" as const;
}

function toEmdTrackerRecord(row: DealEmdTrackerRow | null, detail: DealEngineDealDetail): DealEmdTrackerRecord {
  const emdDueDate = row?.emd_due_date ?? detail.coordination.inspectionEndsOn ?? "";
  const amount = asNumber(row?.emd_amount) || Number(detail.contractDraft?.earnestMoney.replace(/[^0-9.-]/g, "")) || 0;
  let emdStatus = (row?.emd_status as DealEmdTrackerRecord["emdStatus"] | null) ?? "pending";
  const alertFlags: string[] = [];
  if (!row?.emd_holder?.trim()) alertFlags.push("No EMD holder assigned.");
  if (emdDueDate) {
    const due = new Date(emdDueDate);
    if (!Number.isNaN(due.getTime())) {
      const diff = due.getTime() - Date.now();
      if (diff < 0 && !["received", "released", "forfeited", "not_required"].includes(emdStatus)) {
        emdStatus = "overdue";
        alertFlags.push("EMD is overdue.");
      } else if (diff <= 24 * 60 * 60 * 1000 && diff >= 0 && ["pending", "submitted"].includes(emdStatus)) {
        alertFlags.push("EMD is due within 24 hours.");
      }
    }
  }
  return {
    id: row?.id ?? null,
    emdAmount: amount,
    emdDueDate,
    emdHolder: row?.emd_holder ?? detail.coordination.titleCompany ?? "",
    emdHolderType: (row?.emd_holder_type as DealEmdTrackerRecord["emdHolderType"] | null) ?? "title_company",
    emdStatus,
    emdPaymentMethod: row?.emd_payment_method ?? "",
    emdReceiptUrl: row?.emd_receipt_url ?? "",
    emdNotes: row?.emd_notes ?? "",
    alertFlags,
    statusTone: computeEmdStatusTone(emdStatus),
  };
}

function toAssignmentTrackerRecord(row: DealAssignmentFeeTrackerRow | null, detail: DealEngineDealDetail): DealAssignmentFeeTrackerRecord {
  const sellerContractPrice =
    asNumber(row?.seller_contract_price)
    || detail.underwriting.purchasePriceTarget
    || detail.underwriting.maximumAllowableOffer
    || 0;
  const assignmentFeeSeed =
    asNumber(row?.assignment_fee)
    || detail.underwriting.assignmentFeeTarget
    || Number(detail.lead.assignmentFee.replace(/[^0-9.-]/g, "")) || 0;
  const buyerAssignmentPrice =
    asNumber(row?.buyer_assignment_price)
    || (sellerContractPrice && assignmentFeeSeed ? sellerContractPrice + assignmentFeeSeed : 0);
  const assignmentFee = clampMoney(buyerAssignmentPrice - sellerContractPrice);
  const titleCompanyFee = asNumber(row?.title_company_fee);
  const otherClosingCosts = asNumber(row?.other_closing_costs);
  const expectedNetFee = clampMoney(assignmentFee - titleCompanyFee - otherClosingCosts);
  const payoutStatus = (row?.payout_status as DealAssignmentFeeTrackerRecord["payoutStatus"] | null) ?? "projected";
  const closingWarning =
    ["projected", "pending_closing", "delayed"].includes(payoutStatus)
      ? "Closing-day payout is not fully confirmed yet."
      : null;

  return {
    id: row?.id ?? null,
    sellerContractPrice,
    buyerAssignmentPrice,
    assignmentFee,
    expectedNetFee,
    titleCompanyFee,
    otherClosingCosts,
    payoutStatus,
    payoutDueDate: row?.payout_due_date ?? detail.coordination.closingDate ?? "",
    payoutReceivedAt: row?.payout_received_at ?? detail.closeout?.recordedAt ?? "",
    payoutNotes: row?.payout_notes ?? "",
    closingWarning,
  };
}

function toTimelineEventRecord(row: DealClosingTimelineEventRow): DealClosingTimelineEventRecord {
  const status = row.status === "complete" || row.status === "delayed" || row.status === "blocked" ? row.status : "upcoming";
  return {
    id: row.id,
    eventType: row.event_type,
    label: row.label,
    status,
    dueDate: row.due_date ?? "",
    completedAt: row.completed_at ?? "",
    notes: row.notes ?? "",
    updatedAt: row.updated_at,
  };
}

function toDocumentVaultRecord(row: DealDocumentVaultRow): DealDocumentVaultRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    fileType: row.file_type ?? "application/octet-stream",
    category: row.category,
    uploadedBy: row.uploaded_by ?? "Blackspire operator",
    uploadedAt: row.uploaded_at,
    documentUrl: row.document_url ?? "",
    notes: row.notes ?? "",
    linkedItemType: row.linked_item_type ?? "",
    linkedItemId: row.linked_item_id ?? "",
  };
}

async function bootstrapMissingTitleChecklist(supabase: SupabaseClient, dealId: string) {
  const payload = DEFAULT_TITLE_CHECKLIST.map(([itemKey, label], index) => ({
    deal_id: dealId,
    item_key: itemKey,
    label,
    status: "pending",
    assigned_owner: index < 3 ? "Acquisitions" : "Transaction coordination",
    due_date: "",
  }));
  const { error } = await supabase.from("deal_title_checklist_items").insert(payload);
  if (error && !isDuplicateInsertError(error)) throw new Error(error.message);
}

async function bootstrapMissingTimeline(supabase: SupabaseClient, dealId: string, detail: DealEngineDealDetail) {
  const payload = DEFAULT_TIMELINE.map(([eventType, label], index) => ({
    deal_id: dealId,
    event_type: eventType,
    label,
    status: index === 0 ? "complete" : "upcoming",
    completed_at: index === 0 ? detail.activityFeed.at(-1)?.timestamp ?? detail.lead.id : "",
    due_date: eventType === "emd_due" ? detail.coordination.inspectionEndsOn : eventType === "closing_scheduled" ? detail.coordination.closingDate : "",
    notes: "",
  }));
  const { error } = await supabase.from("deal_closing_timeline_events").insert(payload);
  if (error && !isDuplicateInsertError(error)) throw new Error(error.message);
}

export async function generatePurchaseAgreementDraft(dealId: string) {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  return {
    draftType: "purchase_agreement",
    title: "Purchase Agreement draft",
    body: buildPurchaseAgreementText(detail),
    specialTerms: deriveContractTerms(detail).specialTerms,
    disclaimer: buildContractDisclaimer(),
  };
}

export async function generateAssignmentAgreementDraft(dealId: string) {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  return {
    draftType: "assignment_agreement",
    title: "Assignment Agreement draft",
    body: buildAssignmentAgreementText(detail),
    specialTerms: deriveContractTerms(detail).specialTerms,
    disclaimer: buildContractDisclaimer(),
  };
}

export async function generateDealAddendumDraft(dealId: string, addendumType: string) {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  const type = sanitizeDraftType(addendumType || "general_addendum");
  return {
    draftType: type,
    title: `${type.replaceAll("_", " ")} draft`,
    body: buildAddendumText(detail, type),
    specialTerms: deriveContractTerms(detail).specialTerms,
    disclaimer: buildContractDisclaimer(),
  };
}

export async function listContractTemplates(filters?: Partial<{
  type: string;
  state: string;
  approvalStatus: string;
}>): Promise<DealContractTemplateRecord[]> {
  const staticTemplates = CONTRACT_TEMPLATE_REGISTRY.map(toContractTemplateRecord);
  const supabase = getSupabaseAdmin();

  let storedTemplates: DealContractTemplateRecord[] = [];
  if (supabase) {
    await syncContractTemplateRegistry(supabase).catch(() => null);
    const { data, error } = await supabase
      .from("contract_templates")
      .select("id,template_key,template_type,name,intended_purpose,source_name,source_url,license_status,approval_status,state,version,required_fields,optional_fields,variable_map,storage_path,notes")
      .order("created_at", { ascending: false });
    if (error && !isMissingDealTransactionTableError(error)) {
      throw new Error(error.message);
    }
    storedTemplates = ((data as ContractTemplateRow[] | null) ?? []).map(toContractTemplateRecord);
  }

  const merged = [...storedTemplates, ...staticTemplates.filter((staticTemplate) => !storedTemplates.some((stored) => stored.templateKey === staticTemplate.templateKey))];
  const approvalRank: Record<string, number> = {
    attorney_approved: 0,
    attorney_review_required: 1,
    reference_only: 2,
  };

  return merged.filter((template) => {
    if (filters?.type?.trim() && template.type !== filters.type.trim()) return false;
    if (filters?.state?.trim() && template.state && template.state !== filters.state.trim()) return false;
    if (filters?.approvalStatus?.trim() && template.approvalStatus !== filters.approvalStatus.trim()) return false;
    return true;
  }).sort((left, right) => {
    const leftWeight = approvalRank[left.approvalStatus] ?? 9;
    const rightWeight = approvalRank[right.approvalStatus] ?? 9;
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    if ((left.state ?? "") !== (right.state ?? "")) return String(left.state ?? "").localeCompare(String(right.state ?? ""));
    return left.name.localeCompare(right.name);
  });
}

export async function getContractTemplateByType(templateType: string, state?: string, templateKey?: string) {
  const templates = await listContractTemplates({ type: sanitizeDraftType(templateType), state: state?.trim() || undefined });
  if (templateKey?.trim()) {
    return templates.find((template) => template.templateKey === templateKey.trim()) ?? null;
  }
  const approvalRank: Record<string, number> = {
    attorney_approved: 0,
    attorney_review_required: 1,
    reference_only: 2,
  };
  const rankedTemplates = [...templates].sort((left, right) => {
    const stateWeightLeft = left.state === state ? 0 : 1;
    const stateWeightRight = right.state === state ? 0 : 1;
    if (stateWeightLeft !== stateWeightRight) return stateWeightLeft - stateWeightRight;
    const approvalWeightLeft = approvalRank[left.approvalStatus] ?? 9;
    const approvalWeightRight = approvalRank[right.approvalStatus] ?? 9;
    if (approvalWeightLeft !== approvalWeightRight) return approvalWeightLeft - approvalWeightRight;
    return left.name.localeCompare(right.name);
  });
  return rankedTemplates.find((template) => isTemplateAllowedForGeneration(template as ContractTemplateRecord))
    ?? rankedTemplates[0]
    ?? null;
}

export function validateTemplatePurpose(templateType: string, requestedUse: string) {
  const normalizedType = sanitizeDraftType(templateType);
  const normalizedUse = sanitizeDraftType(requestedUse);
  if (normalizedType !== normalizedUse) {
    return {
      ok: false as const,
      error: `Template misuse blocked. ${normalizedType} cannot be used as ${normalizedUse}.`,
    };
  }
  return { ok: true as const };
}

export async function validateDealFieldsForTemplate(
  dealId: string,
  templateType: string,
  options?: { state?: string; templateKey?: string; requestedUse?: string },
): Promise<DealContractTemplateValidation | null> {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;

  const requestedUse = sanitizeDraftType(options?.requestedUse || templateType);
  const template = await getContractTemplateByType(templateType, options?.state, options?.templateKey);
  if (!template) {
    throw new Error(`No template is registered for ${templateType}.`);
  }

  const purposeCheck = validateTemplatePurpose(template.type, requestedUse);
  const emd = await getDealEmdStatus(dealId);
  const assignment = await calculateDealAssignmentFee(dealId);
  const documents = await listDealDocuments(dealId);
  const values: Record<string, unknown> = dealFieldPayload(detail, emd, assignment, documents);
  const missingFields = template.requiredFields.filter((field) => !formatContractFieldValue(field, values[field]));
  const blockedByApproval = template.approvalStatus === "reference_only";
  const blockedByStorage = !template.storagePath;

  return {
    template,
    requestedUse,
    purposeValid: purposeCheck.ok,
    blockingError: purposeCheck.ok
      ? blockedByApproval
        ? "Reference template only. Attorney-approved or attorney-reviewed language is required before signature prep."
        : blockedByStorage
          ? "This template has no reusable file attached yet."
          : null
      : purposeCheck.error,
    missingFields,
    availableFields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, formatContractFieldValue(key, value)])),
    disclaimerRequired: true,
    canGenerate: purposeCheck.ok && !blockedByApproval && !blockedByStorage,
  };
}

export async function generateContractDraftFromTemplate(
  dealId: string,
  templateType: string,
  options?: { state?: string; templateKey?: string; requestedUse?: string },
) {
  const validation = await validateDealFieldsForTemplate(dealId, templateType, options);
  if (!validation) return null;

  if (!validation.purposeValid) {
    return { ok: false as const, error: validation.blockingError ?? "Template misuse blocked.", validation };
  }

  if (!validation.canGenerate) {
    return { ok: false as const, error: validation.blockingError ?? "Template is not available for generation.", validation };
  }

  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  const templateBody = await readTemplateStorage(validation.template);
  const renderedBody = fillTemplateVariables(templateBody, validation.availableFields);
  const specialTerms = validation.availableFields.special_terms || "";
  const title = `${validation.template.name} draft`;
  const warningLines = buildTemplateSafetyLines(validation.template);
  const generatedBody = [renderedBody.trim(), "", "Blackspire Legal Safety Notice", ...warningLines.map((line) => `- ${line}`)].join("\n");

  await writeContractAuditLog({
    dealId,
    templateId: validation.template.id,
    action: "draft_generated",
    metadata: {
      templateKey: validation.template.templateKey,
      templateType: validation.template.type,
      missingFields: validation.missingFields,
    },
  });

  return {
    ok: true as const,
    draft: {
      id: `${dealId}-${validation.template.templateKey}`,
      draftType: validation.template.type,
      templateId: validation.template.id,
      templateType: validation.template.type,
      status: validation.missingFields.length ? "incomplete" : "draft",
      title,
      body: generatedBody,
      specialTerms,
      generatedPdfUrl: "",
      editablePayload: validation.availableFields,
      legalDisclaimerAcknowledged: false,
      updatedAt: new Date().toISOString(),
    } satisfies DealContractDraftRecord,
    validation,
  };
}

export async function saveGeneratedContractDraft(input: {
  dealId: string;
  templateId?: string | null;
  templateKey?: string | null;
  templateType: string;
  title: string;
  body: string;
  specialTerms?: string;
  status?: string;
  editablePayload?: Record<string, unknown>;
  legalDisclaimerAcknowledged?: boolean;
  generatedPdfUrl?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };

  const template = input.templateKey?.trim()
    ? (await listContractTemplates()).find((entry) => entry.templateKey === input.templateKey?.trim()) ?? null
    : null;

  const payload = {
    deal_id: input.dealId,
    draft_type: sanitizeDraftType(input.templateType),
    template_type: sanitizeDraftType(input.templateType),
    template_id: input.templateId ?? template?.id ?? null,
    title: input.title,
    body: input.body,
    generated_body: input.body,
    special_terms: input.specialTerms ?? "",
    status: input.status?.trim() || "draft",
    generated_pdf_url: input.generatedPdfUrl ?? "",
    editable_payload: input.editablePayload ?? {},
    legal_disclaimer_acknowledged: Boolean(input.legalDisclaimerAcknowledged),
    metadata: {
      templateKey: input.templateKey ?? template?.templateKey ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("deal_contract_drafts").upsert(payload, { onConflict: "deal_id,draft_type" });
  if (error) return { ok: false as const, error: error.message };

  await writeContractAuditLog({
    dealId: input.dealId,
    templateId: payload.template_id,
    action: "draft_saved",
    metadata: {
      templateType: payload.template_type,
      title: payload.title,
      legalDisclaimerAcknowledged: payload.legal_disclaimer_acknowledged,
    },
  });

  return { ok: true as const };
}

function wrapPdfText(text: string, maxChars = 92) {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      lines.push("");
      continue;
    }
    let remaining = line;
    while (remaining.length > maxChars) {
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    lines.push(remaining);
  }
  return lines;
}

export async function exportContractDraftToPdf(draftId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const { data, error } = await supabase
    .from("deal_contract_drafts")
    .select("id,deal_id,draft_type,template_type,title,body,special_terms,generated_body,generated_pdf_url,editable_payload,legal_disclaimer_acknowledged,metadata,created_at,updated_at")
    .eq("id", draftId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Draft not found." };

  const row = data as DealContractDraftRow & { deal_id: string };
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const { height } = page.getSize();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.03, 0.05, 0.08) });
  page.drawText("BLACKSPIRE DEAL ENGINE", {
    x: 48,
    y: height - 70,
    size: 22,
    font: titleFont,
    color: rgb(0.22, 0.83, 0.92),
  });
  page.drawText(row.title, {
    x: 48,
    y: height - 98,
    size: 14,
    font: titleFont,
    color: rgb(0.9, 0.86, 0.7),
  });
  page.drawText("Generated documents are not legal advice. Review with a licensed attorney before use.", {
    x: 48,
    y: height - 122,
    size: 10,
    font: bodyFont,
    color: rgb(0.88, 0.62, 0.4),
  });

  let y = height - 154;
  for (const line of wrapPdfText(row.generated_body || row.body || "")) {
    page.drawText(line || " ", {
      x: 48,
      y,
      size: 10.5,
      font: bodyFont,
      color: rgb(0.93, 0.95, 0.98),
    });
    y -= 14;
    if (y < 54) break;
  }

  const bytes = await pdf.save();
  return {
    ok: true as const,
    bytes: Buffer.from(bytes),
    fileName: `${sanitizeDraftType(row.template_type || row.draft_type || "contract")}-${row.id}.pdf`,
    contentType: "application/pdf",
    dealId: row.deal_id,
    draftType: row.template_type || row.draft_type || "contract",
  };
}

export async function attachContractDraftToDocumentVault(dealId: string, draftId: string) {
  const pdf = await exportContractDraftToPdf(draftId);
  if (!pdf.ok) return pdf;
  const upload = await uploadDealDocument({
    dealId,
    category: mapTemplateCategory(pdf.draftType),
    fileName: pdf.fileName,
    contentType: pdf.contentType,
    bytes: new Uint8Array(pdf.bytes),
    owner: "Blackspire contract generator",
    status: "Generated",
    notes: "Generated from the Contract Generator library.",
    source: "contract_generator",
  });
  if (!upload.ok) return upload;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("deal_contract_drafts").update({
      generated_pdf_url: `/api/deal-engine/document?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(upload.documentId)}`,
      updated_at: new Date().toISOString(),
    }).eq("id", draftId);
  }

  await writeContractAuditLog({
    dealId,
    templateId: null,
    action: "draft_attached_to_vault",
    metadata: {
      draftId,
      documentId: upload.documentId,
      category: mapTemplateCategory(pdf.draftType),
    },
  });

  return {
    ok: true as const,
    documentId: upload.documentId,
    documentUrl: `/api/deal-engine/document?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(upload.documentId)}`,
  };
}

export async function saveDealContractDraft(input: {
  dealId: string;
  draftType: string;
  title: string;
  body: string;
  specialTerms?: string;
  templateId?: string | null;
  templateKey?: string | null;
  status?: string;
  editablePayload?: Record<string, unknown>;
  legalDisclaimerAcknowledged?: boolean;
  generatedPdfUrl?: string;
}) {
  const result = await saveGeneratedContractDraft({
    dealId: input.dealId,
    templateId: input.templateId,
    templateKey: input.templateKey,
    templateType: input.draftType,
    title: input.title,
    body: input.body,
    specialTerms: input.specialTerms,
    status: input.status,
    editablePayload: input.editablePayload,
    legalDisclaimerAcknowledged: input.legalDisclaimerAcknowledged,
    generatedPdfUrl: input.generatedPdfUrl,
  });
  if (!result.ok) return result;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("disposition_logs").insert({
      lead_id: input.dealId,
      action_type: "contract_draft_saved",
      payload: { draftType: input.draftType, title: input.title, updatedAt: new Date().toISOString() },
    });
  }
  return { ok: true as const };
}

export async function prepareDealSignaturePacket(input: {
  dealId: string;
  signatureProvider?: string;
  signerEmail?: string;
  signerRole?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const provider = input.signatureProvider?.trim() || "DocuSign";
  const packetUrl = `provider-placeholder://${sanitizeDraftType(provider)}/${encodeURIComponent(input.dealId)}`;
  const { error } = await supabase.from("deal_signature_packets").upsert({
    deal_id: input.dealId,
    signature_status: "prepared",
    signature_provider: provider,
    signature_packet_url: packetUrl,
    signer_email: input.signerEmail?.trim() || null,
    signer_role: input.signerRole?.trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "deal_id" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, packetUrl };
}

export async function updateDealSignatureStatus(input: {
  dealId: string;
  signatureStatus?: string;
  sentForSignatureAt?: string | null;
  signedBySellerAt?: string | null;
  signedByBuyerAt?: string | null;
  signatureProvider?: string;
  signaturePacketUrl?: string;
  signerEmail?: string;
  signerRole?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const { error } = await supabase.from("deal_signature_packets").upsert({
    deal_id: input.dealId,
    signature_status: input.signatureStatus?.trim() || "draft",
    sent_for_signature_at: input.sentForSignatureAt ?? null,
    signed_by_seller_at: input.signedBySellerAt ?? null,
    signed_by_buyer_at: input.signedByBuyerAt ?? null,
    signature_provider: input.signatureProvider?.trim() || null,
    signature_packet_url: input.signaturePacketUrl?.trim() || null,
    signer_email: input.signerEmail?.trim() || null,
    signer_role: input.signerRole?.trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "deal_id" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function bootstrapDealTitleChecklist(dealId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  await bootstrapMissingTitleChecklist(supabase, dealId).catch(() => null);
  return listDealTitleChecklist(dealId);
}

export async function listDealTitleChecklist(dealId: string): Promise<DealTitleChecklistItemRecord[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("deal_title_checklist_items")
    .select("id,item_key,label,status,notes,due_date,assigned_owner,updated_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingDealTransactionTableError(error)) return [];
    throw new Error(error.message);
  }
  if (!(data?.length)) {
    await bootstrapMissingTitleChecklist(supabase, dealId).catch(() => null);
    return listDealTitleChecklist(dealId);
  }
  return (data as DealTitleChecklistItemRow[]).map(toTitleChecklistItemRecord);
}

export async function updateDealTitleChecklistItem(itemId: string, update: Partial<{
  status: string;
  notes: string;
  dueDate: string;
  assignedOwner: string;
}>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const { error } = await supabase.from("deal_title_checklist_items").update({
    status: update.status?.trim() || "pending",
    notes: update.notes?.trim() || "",
    due_date: update.dueDate?.trim() || "",
    assigned_owner: update.assignedOwner?.trim() || "",
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function getDealEmdStatus(dealId: string): Promise<DealEmdTrackerRecord | null> {
  const supabase = getSupabaseAdmin();
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  if (!supabase) return toEmdTrackerRecord(null, detail);
  const { data, error } = await supabase.from("deal_emd_trackers").select("id,emd_amount,emd_due_date,emd_holder,emd_holder_type,emd_status,emd_payment_method,emd_receipt_url,emd_notes,metadata,updated_at").eq("deal_id", dealId).maybeSingle();
  if (error && !isMissingDealTransactionTableError(error)) throw new Error(error.message);
  return toEmdTrackerRecord((data as DealEmdTrackerRow | null) ?? null, detail);
}

export async function updateDealEmdTracker(dealId: string, payload: Partial<DealEmdTrackerRecord>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const { error } = await supabase.from("deal_emd_trackers").upsert({
    deal_id: dealId,
    emd_amount: payload.emdAmount ?? 0,
    emd_due_date: payload.emdDueDate ?? "",
    emd_holder: payload.emdHolder ?? "",
    emd_holder_type: payload.emdHolderType ?? "title_company",
    emd_status: payload.emdStatus ?? "pending",
    emd_payment_method: payload.emdPaymentMethod ?? "",
    emd_receipt_url: payload.emdReceiptUrl ?? "",
    emd_notes: payload.emdNotes ?? "",
    updated_at: new Date().toISOString(),
  }, { onConflict: "deal_id" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function calculateDealAssignmentFee(dealId: string): Promise<DealAssignmentFeeTrackerRecord | null> {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return toAssignmentTrackerRecord(null, detail);
  const { data, error } = await supabase.from("deal_assignment_fee_trackers").select("id,seller_contract_price,buyer_assignment_price,assignment_fee,expected_net_fee,title_company_fee,other_closing_costs,payout_status,payout_due_date,payout_received_at,payout_notes,updated_at").eq("deal_id", dealId).maybeSingle();
  if (error && !isMissingDealTransactionTableError(error)) throw new Error(error.message);
  return toAssignmentTrackerRecord((data as DealAssignmentFeeTrackerRow | null) ?? null, detail);
}

export async function updateDealAssignmentTracker(dealId: string, payload: Partial<DealAssignmentFeeTrackerRecord>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const sellerContractPrice = asNumber(payload.sellerContractPrice);
  const buyerAssignmentPrice = asNumber(payload.buyerAssignmentPrice);
  const assignmentFee = clampMoney(buyerAssignmentPrice - sellerContractPrice);
  const titleCompanyFee = asNumber(payload.titleCompanyFee);
  const otherClosingCosts = asNumber(payload.otherClosingCosts);
  const expectedNetFee = clampMoney(assignmentFee - titleCompanyFee - otherClosingCosts);
  const { error } = await supabase.from("deal_assignment_fee_trackers").upsert({
    deal_id: dealId,
    seller_contract_price: sellerContractPrice,
    buyer_assignment_price: buyerAssignmentPrice,
    assignment_fee: assignmentFee,
    expected_net_fee: expectedNetFee,
    title_company_fee: titleCompanyFee,
    other_closing_costs: otherClosingCosts,
    payout_status: payload.payoutStatus ?? "projected",
    payout_due_date: payload.payoutDueDate ?? "",
    payout_received_at: payload.payoutReceivedAt ?? "",
    payout_notes: payload.payoutNotes ?? "",
    updated_at: new Date().toISOString(),
  }, { onConflict: "deal_id" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, assignmentFee, expectedNetFee };
}

export async function bootstrapDealClosingTimeline(dealId: string) {
  const supabase = getSupabaseAdmin();
  const detail = await getDealEngineDealDetail(dealId);
  if (!supabase || !detail) return [];
  await bootstrapMissingTimeline(supabase, dealId, detail).catch(() => null);
  return listDealClosingTimeline(dealId);
}

export async function listDealClosingTimeline(dealId: string): Promise<DealClosingTimelineEventRecord[]> {
  const supabase = getSupabaseAdmin();
  const detail = await getDealEngineDealDetail(dealId);
  if (!supabase || !detail) return [];
  const { data, error } = await supabase.from("deal_closing_timeline_events").select("id,event_type,label,status,due_date,completed_at,notes,updated_at").eq("deal_id", dealId).order("created_at", { ascending: true });
  if (error) {
    if (isMissingDealTransactionTableError(error)) return [];
    throw new Error(error.message);
  }
  if (!(data?.length)) {
    await bootstrapMissingTimeline(supabase, dealId, detail).catch(() => null);
    return listDealClosingTimeline(dealId);
  }
  return (data as DealClosingTimelineEventRow[]).map(toTimelineEventRecord);
}

export async function createDealTimelineEvent(dealId: string, payload: Partial<DealClosingTimelineEventRecord>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const { data, error } = await supabase.from("deal_closing_timeline_events").insert({
    deal_id: dealId,
    event_type: payload.eventType?.trim() || `custom_event_${Date.now()}`,
    label: payload.label?.trim() || "Custom event",
    status: payload.status ?? "upcoming",
    due_date: payload.dueDate ?? "",
    completed_at: payload.completedAt ?? "",
    notes: payload.notes ?? "",
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, eventId: String(data.id) };
}

export async function updateDealTimelineEvent(eventId: string, payload: Partial<DealClosingTimelineEventRecord>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: `Missing Supabase env: ${getEnvState().missing.join(", ")}` };
  const { error } = await supabase.from("deal_closing_timeline_events").update({
    label: payload.label?.trim() || undefined,
    status: payload.status ?? undefined,
    due_date: payload.dueDate ?? undefined,
    completed_at: payload.completedAt ?? undefined,
    notes: payload.notes ?? undefined,
    updated_at: new Date().toISOString(),
  }).eq("id", eventId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function listDealDocuments(dealId: string, category?: string): Promise<DealDocumentVaultRecord[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  let query = supabase.from("deal_documents").select("id,document_id,file_name,file_type,category,uploaded_by,uploaded_at,document_url,storage_path,notes,linked_item_type,linked_item_id,updated_at").eq("deal_id", dealId).order("uploaded_at", { ascending: false });
  if (category?.trim()) query = query.eq("category", category.trim());
  const { data, error } = await query;
  if (error) {
    if (isMissingDealTransactionTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data as DealDocumentVaultRow[] ?? []).map(toDocumentVaultRecord);
}

export async function getDealTransactionCenter(dealId: string): Promise<DealTransactionCenterSnapshot | null> {
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return null;
  const supabase = getSupabaseAdmin();
  const contractTemplates = await listContractTemplates().catch(() => CONTRACT_TEMPLATE_REGISTRY.map(toContractTemplateRecord));
  if (!supabase) {
    return {
      contractTemplates,
      contracts: [],
      signaturePacket: toSignaturePacketRecord(null),
      titleChecklist: [],
      emdTracker: toEmdTrackerRecord(null, detail),
      assignmentTracker: toAssignmentTrackerRecord(null, detail),
      timeline: [],
      documents: [],
    };
  }

  const [
    contractDraftRows,
    signaturePacketRow,
    titleChecklist,
    emdTracker,
    assignmentTracker,
    timeline,
    documents,
  ] = await Promise.all([
    supabase.from("deal_contract_drafts").select("id,draft_type,title,body,special_terms,template_id,template_type,status,generated_body,generated_pdf_url,editable_payload,legal_disclaimer_acknowledged,metadata,created_at,updated_at").eq("deal_id", dealId).order("updated_at", { ascending: false }),
    supabase.from("deal_signature_packets").select("id,signature_status,sent_for_signature_at,signed_by_seller_at,signed_by_buyer_at,signature_provider,signature_packet_url,signer_email,signer_role,metadata").eq("deal_id", dealId).maybeSingle(),
    listDealTitleChecklist(dealId),
    getDealEmdStatus(dealId),
    calculateDealAssignmentFee(dealId),
    listDealClosingTimeline(dealId),
    listDealDocuments(dealId),
  ]);

  const contractRows = contractDraftRows.error && !isMissingDealTransactionTableError(contractDraftRows.error)
    ? (() => { throw new Error(contractDraftRows.error.message); })()
    : (contractDraftRows.data as DealContractDraftRow[] | null) ?? [];

  let contracts = contractRows.map(toContractDraftRecord);
  if (!contracts.length) {
    const purchase = await generatePurchaseAgreementDraft(dealId);
    const assignment = await generateAssignmentAgreementDraft(dealId);
    const inspectionAddendum = await generateDealAddendumDraft(dealId, "inspection_period_addendum");
    const closingExtension = await generateDealAddendumDraft(dealId, "closing_extension_addendum");
    contracts = [purchase, assignment, inspectionAddendum, closingExtension]
      .filter(Boolean)
      .map((draft) => ({
        id: `${dealId}-${draft!.draftType}`,
        draftType: draft!.draftType,
        templateId: null,
        templateType: draft!.draftType,
        status: "draft",
        title: draft!.title,
        body: draft!.body,
        specialTerms: draft!.specialTerms,
        generatedPdfUrl: "",
        editablePayload: {},
        legalDisclaimerAcknowledged: false,
        updatedAt: new Date().toISOString(),
      }));
  }

  return {
    contractTemplates,
    contracts,
    signaturePacket: toSignaturePacketRecord((signaturePacketRow.data as DealSignaturePacketRow | null) ?? null),
    titleChecklist,
    emdTracker: emdTracker ?? toEmdTrackerRecord(null, detail),
    assignmentTracker: assignmentTracker ?? toAssignmentTrackerRecord(null, detail),
    timeline,
    documents,
  };
}
