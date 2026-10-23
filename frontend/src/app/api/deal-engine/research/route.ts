import { NextRequest, NextResponse } from "next/server";
import { guardAdminApiContext } from "@/lib/operator-access";
import { propertyResearchStore, ResearchSaveError, validateResearchDealId } from "@/lib/property-research-server";
import { readBoundedRequestBody } from "@/lib/bounded-request-body";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return NextResponse.json({ ok: false, error: error instanceof ResearchSaveError ? error.message : "Research is unavailable. Your draft is preserved." }, { status: error instanceof ResearchSaveError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: NextRequest) {
  const gate = await guardAdminApiContext();
  if ("response" in gate) return gate.response;
  try {
    const dealId = validateResearchDealId(request.nextUrl.searchParams.get("dealId"));
    return NextResponse.json({ ok: true, snapshot: await propertyResearchStore().load(dealId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const gate = await guardAdminApiContext();
  if ("response" in gate) return gate.response;
  try {
    let raw: string;
    try { raw = await readBoundedRequestBody(request, 128 * 1024); }
    catch { throw new ResearchSaveError("Research could not be read or is too large. Keep at most 30 comparable and 30 title-evidence rows.", 413); }
    let body;
    try { body = JSON.parse(raw); } catch { throw new ResearchSaveError("Research input is invalid.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ResearchSaveError("Research input is invalid.", 400);
    const dealId = validateResearchDealId(body.dealId);
    return NextResponse.json({ ok: true, snapshot: await propertyResearchStore().save(dealId, body.expectedRevision, body.research, gate.operatorId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
