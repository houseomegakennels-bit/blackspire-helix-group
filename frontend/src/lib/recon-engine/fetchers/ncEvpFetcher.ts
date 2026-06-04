import "server-only";

import type { NormalizedOpportunity } from "@/lib/recon-engine/fetchers/opportunityTypes";

const DEFAULT_EVP_URL = "https://evp.nc.gov/solicitations/";
const DEFAULT_DETAILS_PATH = "/solicitations/details/";
const MAX_EVP_RESULTS = 100;
const DEFAULT_BASE64_SECURE_CONFIGURATION =
  "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";

type NcEvpFetchOptions = {
  limit?: number;
  url?: string;
  secureConfiguration?: string;
};

type EvpGridPayload = {
  base64SecureConfiguration: string;
  sortExpression: string;
  search: string;
  page: number;
  pageSize: number;
  pagingCookie: string;
  filter: null;
  metaFilter: null;
  nlSearchFilter: null;
  timezoneOffset: number;
  customParameters: [];
};

type EvpGridAttribute = {
  Name: string;
  Value: unknown;
  DisplayValue?: string | null;
  FormattedValue?: string | null;
};

type EvpGridRecord = {
  Id: string;
  EntityName: string;
  Attributes: Record<string, EvpGridAttribute>;
};

type EvpGridResponse = {
  Records?: EvpGridRecord[];
};

function getUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
}

function getHeadersSetCookie(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function toCookieHeader(values: string[]) {
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function extractVerificationToken(tokenHtml: string) {
  const match = tokenHtml.match(/value="([^"]+)"/i);
  return match?.[1] ?? null;
}

function extractGridDataUrl(pageHtml: string, pageUrl: string) {
  const match = pageHtml.match(/data-get-url="([^"]+)"/i);
  if (!match) {
    throw new Error("NC eVP page no longer exposes its entity-grid endpoint.");
  }

  return new URL(match[1], pageUrl).toString();
}

function getEasternTimezoneOffsetMinutes() {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((item) => item.type === "timeZoneName")?.value;

    const match = part?.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 240;

    const sign = match[1] === "-" ? 1 : -1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? "0");
    return sign * (hours * 60 + minutes);
  } catch {
    return 240;
  }
}

function parsePortalDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/\/Date\((\d+)\)\//);
  if (!match) {
    return null;
  }

  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function getAttributeMap(record: EvpGridRecord) {
  return Object.fromEntries(Object.values(record.Attributes).map((attribute) => [attribute.Name, attribute]));
}

function getAttributeText(attribute?: EvpGridAttribute): string | null {
  const text = attribute?.DisplayValue ?? attribute?.FormattedValue;
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }

  if (typeof attribute?.Value === "string" && attribute.Value.trim()) {
    return attribute.Value.trim();
  }

  if (
    attribute?.Value &&
    typeof attribute.Value === "object" &&
    "Name" in attribute.Value &&
    typeof (attribute.Value as { Name?: unknown }).Name === "string"
  ) {
    const name = (attribute.Value as { Name: string }).Name.trim();
    return name || null;
  }

  return null;
}

function buildDetailUrl(id: string, pageUrl: string) {
  return new URL(`${DEFAULT_DETAILS_PATH}?id=${encodeURIComponent(id)}`, pageUrl).toString();
}

function resolvePostedCategory(status: string | null) {
  if (!status) return "Open solicitation";
  return `NC eVP · ${status}`;
}

async function createGridSession(pageUrl: string) {
  const pageResponse = await fetch(pageUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": getUserAgent(),
    },
  });
  if (!pageResponse.ok) {
    throw new Error(`NC eVP page request failed with status ${pageResponse.status}.`);
  }

  const pageHtml = await pageResponse.text();
  const pageCookies = getHeadersSetCookie(pageResponse.headers);
  const baseCookieHeader = toCookieHeader(pageCookies);

  const tokenResponse = await fetch(new URL("/_layout/tokenhtml", pageUrl), {
    headers: {
      Accept: "text/html, */*; q=0.01",
      Cookie: baseCookieHeader,
      Referer: pageUrl,
      "User-Agent": getUserAgent(),
    },
  });
  if (!tokenResponse.ok) {
    throw new Error(`NC eVP token request failed with status ${tokenResponse.status}.`);
  }

  const tokenHtml = await tokenResponse.text();
  const verificationToken = extractVerificationToken(tokenHtml);
  if (!verificationToken) {
    throw new Error("NC eVP token request did not return a verification token.");
  }

  const cookieHeader = toCookieHeader([...pageCookies, ...getHeadersSetCookie(tokenResponse.headers)]);

  return {
    cookieHeader,
    gridDataUrl: extractGridDataUrl(pageHtml, pageUrl),
    verificationToken,
  };
}

async function fetchGridRecords(
  gridDataUrl: string,
  pageUrl: string,
  cookieHeader: string,
  verificationToken: string,
  payload: EvpGridPayload,
) {
  const response = await fetch(gridDataUrl, {
    method: "POST",
    headers: {
      __RequestVerificationToken: verificationToken,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json; charset=UTF-8",
      Cookie: cookieHeader,
      Origin: new URL(pageUrl).origin,
      Referer: pageUrl,
      "User-Agent": getUserAgent(),
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  if (!response.ok) {
    const hint =
      response.status >= 500
        ? " The stored NC eVP secure configuration may need to be refreshed."
        : "";
    throw new Error(`NC eVP grid request failed with status ${response.status}.${hint}`);
  }

  const parsed = JSON.parse(rawText) as EvpGridResponse;
  return parsed.Records ?? [];
}

export async function fetchNcEvpOpportunities(
  options: NcEvpFetchOptions = {},
): Promise<NormalizedOpportunity[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, MAX_EVP_RESULTS));
  const pageUrl = options.url ?? DEFAULT_EVP_URL;
  const secureConfiguration =
    options.secureConfiguration?.trim() ||
    process.env.RECON_NC_EVP_SECURE_CONFIG?.trim() ||
    DEFAULT_BASE64_SECURE_CONFIGURATION;

  if (!secureConfiguration) {
    throw new Error("Missing NC eVP secure configuration.");
  }

  const session = await createGridSession(pageUrl);
  const payload: EvpGridPayload = {
    base64SecureConfiguration: secureConfiguration,
    sortExpression: "evp_posteddate DESC",
    search: "",
    page: 1,
    pageSize: limit,
    pagingCookie: "",
    filter: null,
    metaFilter: null,
    nlSearchFilter: null,
    timezoneOffset: getEasternTimezoneOffsetMinutes(),
    customParameters: [],
  };

  const records = await fetchGridRecords(
    session.gridDataUrl,
    pageUrl,
    session.cookieHeader,
    session.verificationToken,
    payload,
  );

  return records.slice(0, limit).map((record) => {
    const attributes = getAttributeMap(record);
    const solicitationNumber = getAttributeText(attributes.evp_solicitationnbr);
    const title = getAttributeText(attributes.evp_name) || solicitationNumber || "Untitled opportunity";
    const description = getAttributeText(attributes.evp_description);
    const status = getAttributeText(attributes.statuscode);
    const agency = getAttributeText(attributes.owningbusinessunit);
    const postedDate = parsePortalDate(attributes.evp_posteddate?.Value);
    const openingDate = parsePortalDate(attributes.evp_opendate?.Value);
    const detailUrl = buildDetailUrl(record.Id, pageUrl);

    const rawText = [
      solicitationNumber ? `Solicitation: ${solicitationNumber}` : null,
      title ? `Project: ${title}` : null,
      agency ? `Department: ${agency}` : null,
      status ? `Status: ${status}` : null,
      postedDate ? `Posted: ${postedDate}` : null,
      openingDate ? `Opening date: ${openingDate}` : null,
      description ? `Description: ${description}` : null,
      detailUrl ? `Details: ${detailUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      sourceName: "NC eVP",
      title,
      agency,
      location: null,
      deadline: openingDate,
      category: resolvePostedCategory(status),
      description,
      originalUrl: detailUrl,
      documentUrl: detailUrl,
      rawText,
    } satisfies NormalizedOpportunity;
  });
}
