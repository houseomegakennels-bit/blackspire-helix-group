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

/** Generate the buyer summary with OpenAI directly. Returns null on any failure. */
async function callOpenAiSummary(payload: SummaryRequest): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini";
  const market =
    payload.county && payload.state ? `${payload.county}, ${payload.state}` : "the target market";
  const propType = payload.propertyType?.replace("_", " ") ?? "property";

  const prompt = `You are an intelligence analyst for a land and real-estate wholesaler. Write a concise 2-3 sentence intelligence summary of this buyer for an operator deciding whether to reach out. Focus on what makes them valuable, their buying pattern, and the best approach angle. Return only the summary text — no preamble, no labels.

Buyer data:
- Name: ${payload.buyerName ?? "Unknown buyer"}
- Entity type: ${payload.isLlc ? "LLC / investment entity" : "individual buyer"}
- Cash buyer: ${payload.isCashBuyer ? "yes" : "no"}
- Recorded purchases (this sweep): ${payload.purchaseCount ?? 0}
- Visible spend: $${Number(payload.totalSpend ?? 0).toLocaleString()}
- Property type: ${propType}
- Market: ${market}
- Score: ${payload.score ?? 0}/100`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 220,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || null;
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

    const aiSummary = await callOpenAiSummary(body);
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
