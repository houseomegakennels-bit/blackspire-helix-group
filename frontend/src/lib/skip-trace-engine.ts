import "server-only";

import { listDealEngineLeads } from "@/lib/deal-engine-server";
import { listSellerLeads } from "@/lib/seller-engine-server";

export type SkipTraceQueueItem = {
  id: string;
  source: "Seller Engine" | "Deal Engine";
  ownerName: string;
  propertyAddress: string;
  county: string;
  phone: string;
  phoneStatus: string;
  skipTraceStatus: string;
  phoneSource: string;
  nextAction: string;
  href: string;
};

export type SkipTraceWorkspaceSnapshot = {
  metrics: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  queue: SkipTraceQueueItem[];
  workflow: Array<{
    title: string;
    detail: string;
  }>;
};

function dedupeByAddress(items: SkipTraceQueueItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.propertyAddress.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getSkipTraceWorkspaceSnapshot(): Promise<SkipTraceWorkspaceSnapshot> {
  const [sellerLeads, dealLeads] = await Promise.all([
    listSellerLeads().catch(() => []),
    listDealEngineLeads(100).catch(() => []),
  ]);

  const dealQueue = dealLeads
    .filter((lead) => !lead.ownerPhone?.trim())
    .map<SkipTraceQueueItem>((lead) => ({
      id: lead.id,
      source: "Deal Engine",
      ownerName: lead.ownerName,
      propertyAddress: lead.propertyAddress,
      county: lead.county,
      phone: lead.ownerPhone?.trim() || "Not captured",
      phoneStatus: lead.phoneStatus ?? "Skip Trace Needed",
      skipTraceStatus: lead.skipTraceStatus ?? "Queued",
      phoneSource: lead.phoneSource ?? "Deal Engine workflow",
      nextAction: lead.nextAction,
      href: `/workspace/deal-engine/${encodeURIComponent(lead.id)}`,
    }));

  const sellerQueue = sellerLeads
    .filter((lead) => !lead.ownerPhone?.trim())
    .map<SkipTraceQueueItem>((lead) => ({
      id: lead.id,
      source: "Seller Engine",
      ownerName: lead.ownerName,
      propertyAddress: lead.propertyAddress,
      county: lead.county,
      phone: lead.ownerPhone?.trim() || "Not captured",
      phoneStatus: lead.phoneStatus ?? "Skip Trace Needed",
      skipTraceStatus: lead.skipTraceStatus ?? "Queued",
      phoneSource: lead.phoneSource ?? "Public record import",
      nextAction: lead.recommendedAction,
      href: `/seller-engine`,
    }));

  const queue = dedupeByAddress([...dealQueue, ...sellerQueue]).sort((left, right) =>
    left.county.localeCompare(right.county) || left.ownerName.localeCompare(right.ownerName),
  );

  const queued = queue.filter((item) => /queued|needed/i.test(item.skipTraceStatus)).length;
  const missingPhone = queue.filter((item) => item.phone === "Not captured").length;

  return {
    metrics: [
      {
        label: "Open Queue",
        value: String(queue.length).padStart(2, "0"),
        detail: "Records across Seller Engine and Deal Engine still needing verified contact resolution.",
      },
      {
        label: "Queued For Skip Trace",
        value: String(queued).padStart(2, "0"),
        detail: "Records that still need a skip trace run or a verified-number pass.",
      },
      {
        label: "Missing Phone",
        value: String(missingPhone).padStart(2, "0"),
        detail: "Records with no stored phone at all yet.",
      },
      {
        label: "Ready For Handoff",
        value: String(Math.max(queue.length - missingPhone, 0)).padStart(2, "0"),
        detail: "Records that can move to verification and outreach once the final contact posture is confirmed.",
      },
    ],
    queue,
    workflow: [
      {
        title: "Ingest the lead from Seller Engine or Deal Engine",
        detail: "Start with records that are missing a verified seller number or still show Skip Trace Needed.",
      },
      {
        title: "Run skip trace and rank the likely numbers",
        detail: "Resolve the best owner phone, identify mobile capability, and note the source of the enrichment result.",
      },
      {
        title: "Verify compliance and outreach posture",
        detail: "Confirm DNC / opt-out posture, decision-maker sensitivity, and the approved first-touch channel.",
      },
      {
        title: "Hand the verified path back to acquisitions",
        detail: "Once the phone is verified, push the record back into Seller Engine or Deal Engine for live outreach.",
      },
    ],
  };
}
