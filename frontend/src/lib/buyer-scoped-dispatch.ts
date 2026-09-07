import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acquireBuyerSources } from "../../../packages/buyer-writer/acquisition.js";
import { approvedBuyerSources } from "../../../packages/buyer-writer/source-approvals.js";
import { createBuyerSourceAdapters } from "@/lib/buyer-source-adapters";
import { postBuyerWriterJson } from "@/lib/buyer-writer-transport";
import type { BuyerDispatchAuthority } from "@/lib/buyer-dispatch-authority";
import type { SearchJobRecord } from "@/lib/buyer-engine-server";

const unavailable = () => new Error("Buyer Engine scoped dispatch failed.");
const opaque = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const webhook = "https://cpearson0312.app.n8n.cloud/webhook/buyer-engine";

export class BuyerDispatchUncertainError extends Error {
  readonly jobId: string;
  readonly requestId: string;
  readonly updatedAt: string | null;
  constructor(jobId: string, requestId: string, updatedAt: string | null) {
    super("Buyer dispatch completion could not be confirmed.");
    this.name = "BuyerDispatchUncertainError";
    this.jobId = jobId;
    this.requestId = requestId;
    this.updatedAt = updatedAt;
  }
}

export function isBuyerDispatchUncertainError(error: unknown): error is BuyerDispatchUncertainError {
  return error instanceof BuyerDispatchUncertainError;
}

export function scopedBuyerWriterEnabled() {
  const mode = process.env.BUYER_WRITER_MODE;
  if (!mode) return false;
  if (mode !== "scoped") throw unavailable();
  return true;
}

// Server-only composition. No browser-selected transport, owner, source approval
// or credentials. Explicit transport injection is only for isolated validation.
export async function dispatchScopedBuyer(
  job: SearchJobRecord,
  authority: BuyerDispatchAuthority,
  supabase: SupabaseClient,
  post = postBuyerWriterJson,
) {
  try {
    if (!scopedBuyerWriterEnabled() || !authority) throw unavailable();
    const base = new URL(process.env.BUYER_WRITER_BASE_URL || "");
    const issuerKey = process.env.BUYER_WRITER_ISSUER_KEY;
    const ingressKey = process.env.BUYER_WRITER_N8N_INGRESS_KEY;
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/"
      || !opaque(issuerKey) || !opaque(ingressKey) || issuerKey === ingressKey) throw unavailable();
    const budget = (maximum: number, reserve = 0) => {
      const available = Math.min(maximum, authority.remainingMs() - reserve);
      if (!Number.isFinite(available) || available < 1) throw unavailable();
      return available;
    };
    const captured = structuredClone(job);
    await authority.assertCurrentOwner(captured);
    const registrySignal = AbortSignal.timeout(budget(8000, 140000));
    const { data, count, error } = await supabase.from("CountyDataSource")
      .select("id,county,state,source_type,source_url,active,notes,created_at", { count: "exact" })
      .eq("county", captured.county).eq("state", captured.state).eq("active", true)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(76).abortSignal(registrySignal);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length || data.length > 75) throw unavailable();
    const rows = data.map(row => {
      if (row.notes !== null && typeof row.notes !== "string") throw unavailable();
      return { ...row, cash_disabled: (row.notes || "").toLowerCase().includes("cash_buyer scoring disabled") };
    });
    const acquired = await acquireBuyerSources({
      job: captured, rows, approved: approvedBuyerSources(captured), adapterFactory: createBuyerSourceAdapters,
      budgets: { maxRequests: 500, maxRows: 50000, maxBytes: 67108864, maxElapsedMs: budget(100000, 140000) },
    });
    await authority.assertCurrentOwner(captured);
    if (authority.remainingMs() < 140000) throw unavailable();
    const requestId = randomUUID();
    const endpoint = new URL(`/api/internal/buyer-writer/v1/jobs/${captured.id}/`, base);
    const original = { version: 1, ownerId: authority.operatorId, requestId, updatedAt: acquired.updatedAt };
    let generation: number | undefined;
    try {
      const issued = await post(new URL("issuance", endpoint), "x-buyer-issuer-key", issuerKey,
        { ...original, criteria: acquired.criteria, sourceContext: acquired.context }, budget(12000, 120000));
      if (!issued || issued.version !== 1 || issued.jobId !== captured.id || issued.dispatchId !== requestId
        || !Number.isSafeInteger(issued.generation) || Number(issued.generation) < 1 || !opaque(issued.permit)) throw unavailable();
      generation = Number(issued.generation);
      await authority.assertCurrentOwner(captured);
      await post(new URL(webhook), "x-buyer-ingress-key", ingressKey, {
        version: 1, jobId: captured.id, dispatchId: requestId, generation, permit: issued.permit,
        rawBase64: acquired.bytes.toString("base64"),
      }, budget(95000, 20000));
    } catch {
      // No replay or raw transport error. Reconcile the SAME attempt/revision,
      // including a response lost after successful SQL or workflow completion.
    }
    let result: Record<string, unknown>;
    try {
      result = await post(new URL("reconciliation", endpoint), "x-buyer-issuer-key", issuerKey, original, budget(12000));
      if (!result || result.dispatchId !== requestId || !["absent", "cancelled", "failed", "completed"].includes(String(result.state))
        || (result.state === "absent" ? result.generation !== null : !Number.isSafeInteger(result.generation) || Number(result.generation) < 1)
        || generation !== undefined && result.generation !== generation) throw unavailable();
    } catch {
      // Preserve bounded, non-secret recovery coordinates. Never classify an
      // unavailable reconciliation endpoint as a confirmed failed transaction.
      throw new BuyerDispatchUncertainError(captured.id, requestId, acquired.updatedAt);
    }
    if (result.state !== "completed") throw unavailable();
    return { webhookUrl: webhook, status: 200, response: { ok: true, status: "completed" } };
  } catch (error) {
    if (isBuyerDispatchUncertainError(error)) throw error;
    throw unavailable();
  }
}
