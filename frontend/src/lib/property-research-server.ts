import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { emptyPropertyResearch, validatePropertyResearch, type PropertyResearch, type ResearchSnapshot } from "@/lib/property-research";

const ACTION = "property_research_v1";
export class ResearchSaveError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function researchRevisionId(dealId: string, revision: number): string {
  const hex = createHash("sha256").update(`blackspire:property-research:v1:${dealId}:${revision}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function validateResearchDealId(value: unknown): string {
  if (typeof value !== "string" || !/^DE-\d{4,12}$/.test(value)) throw new ResearchSaveError("Choose a saved property.", 400);
  return value;
}
function sameResearch(left: PropertyResearch, right: PropertyResearch) { return JSON.stringify(left) === JSON.stringify(right); }

/** Existing disposition_logs PK arbitrates revision claims; no check-then-overwrite UPDATE exists. */
export function createPropertyResearchStore(client: SupabaseClient) {
  async function load(dealId: string): Promise<ResearchSnapshot> {
    validateResearchDealId(dealId);
    const property = await client.from("deal_leads").select("id").eq("id", dealId).maybeSingle();
    if (property.error) throw new ResearchSaveError("Research is unavailable. Try again later.", 503);
    if (!property.data) throw new ResearchSaveError("Property not found.", 404);
    const result = await client.from("disposition_logs").select("id,payload,created_at").eq("lead_id", dealId).eq("action_type", ACTION).order("payload->revision", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw new ResearchSaveError("Research is unavailable. Try again later.", 503);
    if (!result.data) return { revision: 0, updatedAt: null, research: emptyPropertyResearch() };
    const revision = result.data.payload?.revision;
    if (!Number.isSafeInteger(revision) || revision < 1 || result.data.id !== researchRevisionId(dealId, revision)) throw new ResearchSaveError("Research history needs review. Saving is unavailable.", 503);
    try { return { revision, updatedAt: result.data.created_at, research: validatePropertyResearch(result.data.payload.research) }; }
    catch { throw new ResearchSaveError("Research history needs review. Saving is unavailable.", 503); }
  }
  async function save(dealId: string, expectedRevision: number, value: unknown, operatorId: string): Promise<ResearchSnapshot> {
    validateResearchDealId(dealId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 1_000_000) throw new ResearchSaveError("Reload the saved research revision.", 400);
    let research: PropertyResearch;
    try { research = validatePropertyResearch(value); } catch (error) { throw new ResearchSaveError(error instanceof Error ? error.message : "Review the research inputs.", 400); }
    const current = await load(dealId);
    if (current.revision !== expectedRevision) {
      if (current.revision === expectedRevision + 1 && sameResearch(current.research, research)) return current;
      throw new ResearchSaveError("Research changed in another session. Keep your draft and reload before combining changes.", 409);
    }
    const revision = expectedRevision + 1;
    const result = await client.from("disposition_logs").insert({ id: researchRevisionId(dealId, revision), lead_id: dealId, action_type: ACTION, created_by: operatorId, payload: { version: 1, revision, research } }).select("id,created_at").single();
    if (result.error) {
      if (result.error.code === "23505") {
        const saved = await load(dealId);
        if (saved.revision === revision && sameResearch(saved.research, research)) return saved;
        throw new ResearchSaveError("Research changed in another session. Your draft is preserved.", 409);
      }
      // The INSERT may have committed even if its response was lost. Never retry it here.
      throw new ResearchSaveError("Save could not be confirmed. Reload the saved revision before retrying; your draft is preserved.", 503);
    }
    return { revision, updatedAt: result.data.created_at, research };
  }
  return { load, save };
}
export function propertyResearchStore() {
  const url = process.env.SUPABASE_URL?.trim(), key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new ResearchSaveError("Research connection is unavailable.", 503);
  return createPropertyResearchStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
