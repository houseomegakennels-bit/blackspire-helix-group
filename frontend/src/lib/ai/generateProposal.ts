import "server-only";

/**
 * Recon Engine — AI Proposal & Capability Statement Generator (Commander tier).
 * Produces editable draft documents for a specific opportunity tailored to a
 * business profile. OpenAI-powered with a deterministic fallback.
 */

export type ProposalInput = {
  bidTitle: string;
  agency?: string | null;
  location?: string | null;
  summary?: string | null;
  requirements?: string | null;
  bestFitIndustries?: string[];
  company?: string | null;
  industry?: string | null;
  services?: string | null;
};

export type ProposalDraft = {
  coverLetter: string;
  capabilityStatement: string;
  responseChecklist: string;
  procurementQuestions: string;
  proposalOutline: string;
  aiGenerated: boolean;
};

function fallbackProposal(input: ProposalInput): ProposalDraft {
  const company = input.company || "Our company";
  const agency = input.agency || "the issuing agency";
  return {
    coverLetter: `Dear ${agency},\n\n${company} is pleased to submit our response to "${input.bidTitle}". We specialize in ${input.industry || input.services || "the required services"} and are confident we can deliver this work on time and to specification. We welcome the opportunity to discuss our qualifications further.\n\nSincerely,\n${company}`,
    capabilityStatement: `${company} — Capability Statement\n\nCore competencies: ${input.services || input.industry || "see attached"}.\nDifferentiators: responsive, reliable, locally based${input.location ? ` near ${input.location}` : ""}.\nPast performance: available on request.`,
    responseChecklist: "- Confirm registration with the issuing portal\n- Capability statement\n- Proof of insurance / bonding (if required)\n- Pricing / quote\n- Required certifications\n- Submit before the deadline",
    procurementQuestions: "- Is a site visit or pre-bid conference required?\n- What are the insurance/bonding minimums?\n- Are set-aside certifications required to qualify?\n- What is the evaluation criteria and weighting?",
    proposalOutline: "1. Cover letter\n2. Company overview & capability statement\n3. Understanding of requirements\n4. Technical approach\n5. Past performance\n6. Pricing\n7. Required forms & certifications",
    aiGenerated: false,
  };
}

export async function generateProposal(input: ProposalInput): Promise<ProposalDraft> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallbackProposal(input);

  const model = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini";
  const prompt = `You are a government-contract proposal writer helping a small business respond to an opportunity. Using the details below, produce ready-to-edit drafts. Return ONLY a JSON object with these exact string keys:
- "coverLetter": a professional cover letter addressed to the agency.
- "capabilityStatement": a concise capability statement for the business.
- "responseChecklist": a bulleted checklist of everything needed to submit a complete response.
- "procurementQuestions": a bulleted list of smart questions to ask the procurement officer.
- "proposalOutline": a numbered outline of the full proposal document.

Business:
- Company: ${input.company || "Unknown"}
- Industry: ${input.industry || "Unknown"}
- Services: ${input.services || "Unknown"}

Opportunity:
- Title: ${input.bidTitle}
- Agency: ${input.agency || "Unknown"}
- Location: ${input.location || "Unknown"}
- Summary: ${input.summary || "N/A"}
- Requirements: ${input.requirements || "N/A"}
- Best-fit industries: ${(input.bestFitIndustries ?? []).join(", ") || "N/A"}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 1600,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return fallbackProposal(input);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return fallbackProposal(input);

    const p = JSON.parse(content) as Partial<ProposalDraft>;
    const str = (v: unknown, fb: string) => (typeof v === "string" && v.trim() ? v : fb);
    const fb = fallbackProposal(input);
    return {
      coverLetter: str(p.coverLetter, fb.coverLetter),
      capabilityStatement: str(p.capabilityStatement, fb.capabilityStatement),
      responseChecklist: str(p.responseChecklist, fb.responseChecklist),
      procurementQuestions: str(p.procurementQuestions, fb.procurementQuestions),
      proposalOutline: str(p.proposalOutline, fb.proposalOutline),
      aiGenerated: true,
    };
  } catch {
    return fallbackProposal(input);
  }
}
