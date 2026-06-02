import { NextRequest, NextResponse } from "next/server";

type SummaryRequest = {
  buyerName?: string;
  mailingAddress?: string;
  county?: string | null;
  state?: string | null;
  propertyType?: string | null;
  score?: number;
  purchaseCount?: number;
  totalSpend?: number;
  isLlc?: boolean;
  isCashBuyer?: boolean;
  searchJobId?: string;
};

/** Call the Supabase summarize-buyer edge function. */
async function callSummarizeBuyer(payload: SummaryRequest): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/summarize-buyer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;

    // Accept { summary: "..." } or { analysis: "..." } or bare string
    if (typeof json.summary === "string") return json.summary;
    if (typeof json.analysis === "string") return json.analysis;
    if (typeof json === "string") return json;
    return null;
  } catch {
    return null;
  }
}

/** Fallback: generate a local summary without AI. */
function buildLocalSummary(
  buyerName: string,
  county: string | null,
  state: string | null,
  propertyType: string | null,
  score: number,
  purchaseCount: number,
  totalSpend: number,
  isLlc: boolean,
  isCashBuyer: boolean,
): string {
  const parts: string[] = [];

  const entity = isLlc ? "LLC / investment entity" : "individual buyer";
  const market = county && state ? `${county}, ${state}` : "this market";
  const propType = propertyType?.replace("_", " ") ?? "property";

  parts.push(
    `${buyerName} is an ${entity} with ${purchaseCount} recorded ${propType} purchase${purchaseCount !== 1 ? "s" : ""} in ${market}.`,
  );

  if (totalSpend > 0) {
    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(totalSpend);
    parts.push(`Total visible spend across this sweep: ${money}.`);
  }

  const signals: string[] = [];
  if (isLlc) signals.push("operates as an LLC");
  if (isCashBuyer) signals.push("cash buyer — no lender friction");
  if (purchaseCount >= 3) signals.push("repeat buyer pattern");
  if (signals.length) {
    parts.push(`Key signals: ${signals.join(", ")}.`);
  }

  const tier =
    score >= 70
      ? "High-priority target — multiple strong buying signals."
      : score >= 50
        ? "Mid-tier prospect — solid activity with limited friction signals."
        : "Lower-priority lead — limited recent activity detected.";
  parts.push(`Oracle score ${score}/100. ${tier}`);

  parts.push(
    isLlc
      ? "Recommended angle: reference the entity's repeat acquisition pattern and ask if the team is still buying in the area."
      : "Recommended angle: reference their recent purchase activity and ask if they are still actively evaluating deals.",
  );

  return parts.join(" ");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SummaryRequest;

    const buyerName = body.buyerName?.trim() || "Unknown Buyer";
    const county = body.county?.trim() || null;
    const state = body.state?.trim() || null;
    const propertyType = body.propertyType?.trim() || null;
    const score = Number(body.score ?? 0);
    const purchaseCount = Number(body.purchaseCount ?? 0);
    const totalSpend = Number(body.totalSpend ?? 0);
    const isLlc = Boolean(body.isLlc);
    const isCashBuyer = Boolean(body.isCashBuyer);

    const aiSummary = await callSummarizeBuyer(body);
    const summary =
      aiSummary ??
      buildLocalSummary(buyerName, county, state, propertyType, score, purchaseCount, totalSpend, isLlc, isCashBuyer);

    return NextResponse.json({
      ok: true,
      aiGenerated: Boolean(aiSummary),
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Summary generation failed." },
      { status: 500 },
    );
  }
}
