import "server-only";

/**
 * Recon Engine — AI Opportunity Analyzer.
 * Turns a raw opportunity (contract/grant/RFP) into a structured, plain-English
 * analysis. Uses OpenAI when configured, with a deterministic fallback so the
 * pipeline never hard-fails.
 */

export type OpportunityInput = {
  title: string;
  agency?: string | null;
  category?: string | null;
  location?: string | null;
  description?: string | null;
  rawText?: string | null;
  deadline?: string | null;
};

export type OpportunityAnalysis = {
  summary: string;
  requirements: string;
  opportunityType: string;
  documentsNeeded: string[];
  estimatedDifficulty: "Low" | "Medium" | "High";
  estimatedValue: string;
  suggestedNextSteps: string[];
  bestFitIndustries: string[];
  keywords: string[];
  aiGenerated: boolean;
};

function buildFallbackAnalysis(input: OpportunityInput): OpportunityAnalysis {
  const text = `${input.title} ${input.category ?? ""} ${input.description ?? ""}`.toLowerCase();
  const industryMap: Array<[string, string[]]> = [
    ["Lawn Care", ["lawn", "mow", "grounds", "landscap", "turf"]],
    ["Cleaning", ["clean", "janitor", "custodial"]],
    ["Construction", ["construct", "renovat", "build", "repair", "concrete", "roof"]],
    ["Security", ["security", "guard", "surveillance"]],
    ["Pressure Washing", ["pressure wash", "power wash", "exterior clean"]],
    ["IT Services", ["software", "it ", "information technology", "network", "cyber"]],
    ["Transportation", ["transport", "hauling", "fleet", "delivery"]],
    ["Maintenance", ["maintenance", "hvac", "plumbing", "electrical", "facility"]],
  ];
  const bestFitIndustries = industryMap
    .filter(([, terms]) => terms.some((t) => text.includes(t)))
    .map(([industry]) => industry);

  const keywords = [...new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length > 4))].slice(0, 12);

  return {
    summary:
      `${input.title}${input.agency ? ` issued by ${input.agency}` : ""}. ` +
      "Review the full solicitation for scope and submission requirements.",
    requirements:
      "Confirm vendor registration, insurance/bonding, and any certifications required by the issuing agency.",
    opportunityType: input.category || "Government contract",
    documentsNeeded: ["Capability statement", "Proof of insurance", "Vendor registration"],
    estimatedDifficulty: "Medium",
    estimatedValue: "Not specified",
    suggestedNextSteps: [
      "Register with the issuing agency's procurement portal if not already.",
      "Prepare or update your capability statement.",
      "Note the deadline and required submission format.",
    ],
    bestFitIndustries: bestFitIndustries.length ? bestFitIndustries : ["General Services"],
    keywords,
    aiGenerated: false,
  };
}

export async function analyzeOpportunity(input: OpportunityInput): Promise<OpportunityAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return buildFallbackAnalysis(input);

  const model = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini";
  const prompt = `You are an opportunity-intelligence analyst for small businesses bidding on government and commercial contracts. Analyze this opportunity and return ONLY a JSON object with these exact keys:
- "summary": 2-3 plain-English sentences on what this is and who should care.
- "requirements": plain-English summary of what's required to qualify/respond.
- "opportunityType": e.g. "Government contract", "Grant", "RFP", "Vendor registration".
- "documentsNeeded": array of documents likely required.
- "estimatedDifficulty": one of "Low", "Medium", "High".
- "estimatedValue": short string (e.g. "$25k-$75k/yr" or "Not specified").
- "suggestedNextSteps": array of concrete next steps.
- "bestFitIndustries": array of industries best suited (e.g. Lawn Care, Cleaning, Construction, Security, Pressure Washing, IT Services, Transportation, Maintenance).
- "keywords": array of relevant keywords for matching.

Opportunity:
Title: ${input.title}
Agency: ${input.agency ?? "Unknown"}
Category: ${input.category ?? "Unknown"}
Location: ${input.location ?? "Unknown"}
Deadline: ${input.deadline ?? "Unknown"}
Description: ${(input.description ?? input.rawText ?? "").slice(0, 6000)}`;

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
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) return buildFallbackAnalysis(input);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return buildFallbackAnalysis(input);

    const parsed = JSON.parse(content) as Partial<OpportunityAnalysis>;
    const asArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : buildFallbackAnalysis(input).summary,
      requirements: typeof parsed.requirements === "string" ? parsed.requirements : "",
      opportunityType: typeof parsed.opportunityType === "string" ? parsed.opportunityType : "Government contract",
      documentsNeeded: asArray(parsed.documentsNeeded),
      estimatedDifficulty:
        parsed.estimatedDifficulty === "Low" || parsed.estimatedDifficulty === "High"
          ? parsed.estimatedDifficulty
          : "Medium",
      estimatedValue: typeof parsed.estimatedValue === "string" ? parsed.estimatedValue : "Not specified",
      suggestedNextSteps: asArray(parsed.suggestedNextSteps),
      bestFitIndustries: asArray(parsed.bestFitIndustries),
      keywords: asArray(parsed.keywords),
      aiGenerated: true,
    };
  } catch {
    return buildFallbackAnalysis(input);
  }
}
