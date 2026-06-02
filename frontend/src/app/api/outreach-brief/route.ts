import { NextRequest, NextResponse } from "next/server";

import { getCountyOperationalRisk } from "@/lib/buyer-engine-data";

type OutreachRequest = {
  searchJobId?: string;
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
};

type EdgeFnDraft = {
  subject: string;
  angle: string;
  body: string;
};

/** Generate the outreach draft with OpenAI directly. Returns null on any failure. */
async function callOpenAiOutreach(payload: OutreachRequest): Promise<EdgeFnDraft | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini";
  const market =
    payload.county && payload.state ? `${payload.county}, ${payload.state}` : "their market";
  const propType = payload.propertyType?.replace("_", " ") ?? "land";

  const prompt = `You are a real-estate wholesaler's outreach copywriter. Write a short, professional, personalized outreach letter to a buyer who has been acquiring ${propType} in ${market}. Reference their activity naturally, keep it concise and action-oriented, and end with a clear call to action asking whether they are still buying in the area.

Buyer data:
- Name: ${payload.buyerName}
- Entity type: ${payload.isLlc ? "LLC / investment entity" : "individual buyer"}
- Cash buyer: ${payload.isCashBuyer ? "yes" : "no"}
- Recorded purchases (this sweep): ${payload.purchaseCount ?? 0}
- Visible spend: $${Number(payload.totalSpend ?? 0).toLocaleString()}
- Score: ${payload.score ?? 0}/100

Respond with a JSON object using exactly these keys:
- "subject": a short subject line
- "angle": one sentence describing the outreach strategy
- "body": the full letter text, using \\n for line breaks`;

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
        temperature: 0.7,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const draft = JSON.parse(content) as Record<string, unknown>;
    if (typeof draft.subject === "string" && typeof draft.body === "string") {
      return {
        subject: draft.subject,
        angle: typeof draft.angle === "string" ? draft.angle : "",
        body: draft.body,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Template-based fallback — always succeeds. */
function buildTemplateDraft(
  buyerName: string,
  mailingAddress: string,
  county: string | null,
  state: string | null,
  propertyType: string | null,
  score: number,
  purchaseCount: number,
  totalSpend: number,
  isLlc: boolean,
  isCashBuyer: boolean,
  searchJobId: string,
): EdgeFnDraft {
  const countyRisk =
    county && propertyType ? getCountyOperationalRisk(county, propertyType) : null;
  const subject = county && state ? `${county} land acquisitions` : "recent land acquisitions";
  const angle = isLlc
    ? "Reference repeat acquisition activity and ask whether the team is still buying in this market."
    : "Reference recent acquisition activity and ask whether they are still actively buying in this market.";

  const lines = [
    `Hi ${buyerName},`,
    "",
    county && state
      ? `I came across your recent ${propertyType?.replace("_", " ") ?? "land"} purchase activity in ${county}, ${state}.`
      : "I came across your recent land purchase activity.",
    purchaseCount > 1
      ? `It looks like you've been consistently active, with ${purchaseCount} recorded purchases in this sweep.`
      : "It looks like you've been active in this market recently.",
    isCashBuyer
      ? "You also appear to move quickly without lender friction, which usually means you can evaluate opportunities fast."
      : "I'm reaching out because your recent activity suggests you may still be evaluating new deals.",
    isLlc
      ? "I work with owners who prefer clean, direct land opportunities and figured your acquisitions team may still be buying."
      : "I work with owners who prefer clean, direct land opportunities and thought this might be relevant to you.",
    countyRisk ? `Operational note on our side: ${countyRisk.message}` : null,
    "",
    "Are you still buying this type of property in the area right now?",
    "",
    `Context: score ${score}, visible spend ${formatMoney(totalSpend)}, search job ${searchJobId}.`,
  ].filter(Boolean);

  return { subject, angle, body: lines.join("\n") };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OutreachRequest;
    const buyerName = body.buyerName?.trim();
    const mailingAddress = body.mailingAddress?.trim();
    const searchJobId = body.searchJobId?.trim() || "unknown-job";
    const county = body.county?.trim() || null;
    const state = body.state?.trim() || null;
    const propertyType = body.propertyType?.trim() || null;
    const score = Number(body.score ?? 0);
    const purchaseCount = Number(body.purchaseCount ?? 0);
    const totalSpend = Number(body.totalSpend ?? 0);
    const isLlc = Boolean(body.isLlc);
    const isCashBuyer = Boolean(body.isCashBuyer);

    if (!buyerName || !mailingAddress) {
      return NextResponse.json(
        { ok: false, error: "buyerName and mailingAddress are required." },
        { status: 400 },
      );
    }

    // Try OpenAI first, fall back to deterministic template
    const edgeDraft = await callOpenAiOutreach(body);
    const draft = edgeDraft ?? buildTemplateDraft(
      buyerName, mailingAddress, county, state, propertyType,
      score, purchaseCount, totalSpend, isLlc, isCashBuyer, searchJobId,
    );

    return NextResponse.json({
      ok: true,
      aiGenerated: Boolean(edgeDraft),
      draft,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown outreach draft failure." },
      { status: 500 },
    );
  }
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
