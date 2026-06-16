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

  const prompt = `You are writing a real estate buyer outreach message for a real person, not a marketing bot. Write a short, natural, conversational note to a buyer who has been acquiring ${propType} in ${market}. Make it sound like one operator reaching out directly to another person. Avoid hype, corporate phrasing, and obvious template language. Reference their activity naturally, keep it concise, and end by simply asking whether they are still buying in the area.

Buyer data:
- Name: ${payload.buyerName}
- Entity type: ${payload.isLlc ? "LLC / investment entity" : "individual buyer"}
- Cash buyer: ${payload.isCashBuyer ? "yes" : "no"}
- Recorded purchases (this sweep): ${payload.purchaseCount ?? 0}
- Visible spend: $${Number(payload.totalSpend ?? 0).toLocaleString()}
- Score: ${payload.score ?? 0}/100

Respond with a JSON object using exactly these keys:
- "subject": a short subject line
- "angle": one sentence describing the outreach strategy in plain language
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
): EdgeFnDraft {
  const countyRisk =
    county && propertyType ? getCountyOperationalRisk(county, propertyType) : null;
  const propertyLabel = propertyType?.replace("_", " ") ?? "property";
  const subject = county && state ? `Still buying in ${county}?` : "Still buying this type of property?";
  const angle = isLlc
    ? "Keep it direct, mention the team's recent activity, and ask whether they are still buying in this lane."
    : "Keep it personal, mention the buyer's recent activity, and ask whether they are still buying in this lane.";

  const lines = [
    `Hi ${buyerName},`,
    "",
    county && state
      ? `I came across your recent ${propertyLabel} activity in ${county}, ${state} and wanted to reach out directly.`
      : `I came across your recent ${propertyLabel} activity and wanted to reach out directly.`,
    purchaseCount > 1
      ? `It looks like you've been fairly active, with about ${purchaseCount} purchases showing up in this sweep.`
      : "It looks like you've been active in this market recently.",
    isCashBuyer
      ? "You also look like the kind of buyer who can move quickly when something fits."
      : "Your recent activity made me think this might be worth putting in front of you.",
    isLlc
      ? `I work with owners who want a clean, direct sale, and I thought your team might still be looking for ${propertyLabel} deals like that.`
      : `I work with owners who want a clean, direct sale, and I thought this might be relevant if you're still looking for ${propertyLabel} deals.`,
    countyRisk ? `Operational note on our side: ${countyRisk.message}` : null,
    "",
    "Are you still buying this type of property in the area right now?",
    "",
    "If so, I can send over the details.",
    "",
    "Thanks,",
    "Carlos",
  ].filter(Boolean);

  return { subject, angle, body: lines.join("\n") };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OutreachRequest;
    const buyerName = body.buyerName?.trim();
    const mailingAddress = body.mailingAddress?.trim();
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
      score, purchaseCount, totalSpend, isLlc, isCashBuyer,
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
