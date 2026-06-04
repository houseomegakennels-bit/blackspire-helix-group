import "server-only";

/**
 * SAM.gov "Get Opportunities" fetcher.
 * Pulls recent federal contract opportunities (NC place-of-performance first)
 * and normalizes them into the shared opportunity shape that maps onto `bids`.
 * Docs: https://open.gsa.gov/api/get-opportunities-public-api/
 */
import type { NormalizedOpportunity } from "@/lib/recon-engine/fetchers/opportunityTypes";

type SamOpportunity = {
  noticeId?: string;
  title?: string;
  fullParentPathName?: string;
  organizationType?: string;
  type?: string;
  baseType?: string;
  postedDate?: string;
  responseDeadLine?: string | null;
  naicsCode?: string;
  classificationCode?: string;
  typeOfSetAsideDescription?: string | null;
  active?: string;
  uiLink?: string;
  description?: string; // URL to the description text
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string; name?: string };
    zip?: string;
  } | null;
};

function fmtDate(d: Date): string {
  // SAM expects MM/dd/yyyy
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

export type SamFetchOptions = {
  state?: string; // place-of-performance state code, default NC
  lookbackDays?: number; // default 30
  limit?: number; // default 25 (SAM max 1000)
};

export async function fetchSamGovOpportunities(
  options: SamFetchOptions = {},
): Promise<NormalizedOpportunity[]> {
  const apiKey = process.env.SAM_GOV_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SAM_GOV_API_KEY is not configured.");
  }

  const state = (options.state ?? "NC").toUpperCase();
  const lookbackDays = options.lookbackDays ?? 30;
  const limit = Math.min(options.limit ?? 25, 1000);

  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: fmtDate(from),
    postedTo: fmtDate(to),
    limit: String(limit),
    offset: "0",
    state,
    sortBy: "-modifiedDate",
  });

  const url = `https://api.sam.gov/opportunities/v2/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SAM.gov fetch failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      totalRecords?: number;
      opportunitiesData?: SamOpportunity[];
    };

    const mapped = (data.opportunitiesData ?? []).map((opp) => {
      const city = opp.placeOfPerformance?.city?.name;
      const st = opp.placeOfPerformance?.state?.code ?? opp.placeOfPerformance?.state?.name;
      const location = [city, st].filter(Boolean).join(", ") || null;
      const category = [opp.type, opp.typeOfSetAsideDescription].filter(Boolean).join(" · ") || null;
      const rawText = [
        opp.title,
        opp.fullParentPathName ? `Agency: ${opp.fullParentPathName}` : null,
        opp.naicsCode ? `NAICS: ${opp.naicsCode}` : null,
        opp.classificationCode ? `PSC: ${opp.classificationCode}` : null,
        opp.typeOfSetAsideDescription ? `Set-aside: ${opp.typeOfSetAsideDescription}` : null,
        location ? `Location: ${location}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        sourceName: "SAM.gov",
        title: opp.title?.trim() || "Untitled opportunity",
        agency: opp.fullParentPathName?.trim() || null,
        location,
        deadline: opp.responseDeadLine ?? null,
        category,
        description: rawText,
        originalUrl: opp.uiLink ?? (opp.noticeId ? `https://sam.gov/opp/${opp.noticeId}/view` : null),
        documentUrl: opp.description ?? null,
        rawText,
      } satisfies NormalizedOpportunity;
    });

    // NC-first: keep national/HQ listings (null location) and NC; drop listings
    // whose place of performance is an explicit non-NC state.
    return mapped.filter((o) => {
      if (!o.location) return true;
      if (/\bNC\b|north carolina/i.test(o.location)) return true;
      // location ends in a 2-letter state code that isn't NC -> drop
      return !/,\s*[A-Z]{2}\b/.test(o.location);
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the full opportunity description text from SAM's description URL.
 * The api_key must be appended. Returns null on any failure.
 */
export async function fetchSamDescription(descriptionUrl: string): Promise<string | null> {
  const apiKey = process.env.SAM_GOV_API_KEY?.trim();
  if (!apiKey || !descriptionUrl) return null;

  const sep = descriptionUrl.includes("?") ? "&" : "?";
  const url = `${descriptionUrl}${sep}api_key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const text = await res.text();
    // SAM returns either JSON ({ description }) or raw HTML/text.
    try {
      const json = JSON.parse(text) as { description?: string };
      if (typeof json.description === "string") return json.description.replace(/<[^>]+>/g, " ").trim();
    } catch {
      // not JSON — treat as raw text/html
    }
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
