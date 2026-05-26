export type OutreachDraftRecord = {
  id: string;
  source: "buyers" | "searches";
  searchJobId: string;
  buyerName: string;
  mailingAddress: string;
  county: string | null;
  state: string | null;
  propertyType: string | null;
  score: number;
  purchaseCount: number;
  totalSpend: number;
  isLlc: boolean;
  isCashBuyer: boolean;
  subject: string;
  angle: string;
  body: string;
  createdAt: string;
};

export type OutreachDraftStoreStatus = {
  storage: "browser" | "server";
  supported: boolean;
};

type OutreachDraftApiPayload = {
  ok: boolean;
  supported: boolean;
  storage: "browser" | "server";
  drafts?: OutreachDraftRecord[];
  error?: string;
};

const STORAGE_KEY = "blackspire-outreach-drafts-v1";
const MAX_DRAFTS = 12;

function loadLocalOutreachDrafts(searchJobId?: string) {
  if (typeof window === "undefined") return [] as OutreachDraftRecord[];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as OutreachDraftRecord[];
    if (!Array.isArray(parsed)) return [];

    const drafts = parsed.filter((draft) => draft && typeof draft === "object");
    return searchJobId ? drafts.filter((draft) => draft.searchJobId === searchJobId) : drafts;
  } catch {
    return [];
  }
}

function persistLocalOutreachDraft(record: OutreachDraftRecord) {
  if (typeof window === "undefined") return [] as OutreachDraftRecord[];

  const next = [record, ...loadLocalOutreachDrafts().filter((draft) => draft.id !== record.id)].slice(0, MAX_DRAFTS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function loadOutreachDrafts(searchJobId?: string) {
  return loadLocalOutreachDrafts(searchJobId);
}

export function persistOutreachDraft(record: OutreachDraftRecord) {
  return persistLocalOutreachDraft(record);
}

export async function loadOutreachDraftsWithFallback(searchJobId?: string): Promise<{
  drafts: OutreachDraftRecord[];
  status: OutreachDraftStoreStatus;
}> {
  try {
    const queryString = searchJobId ? `?searchJobId=${encodeURIComponent(searchJobId)}` : "";
    const response = await fetch(`/api/outreach-drafts${queryString}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as OutreachDraftApiPayload;

    if (response.ok && payload.ok && payload.supported && payload.drafts) {
      return {
        drafts: payload.drafts,
        status: {
          storage: payload.storage,
          supported: payload.supported,
        },
      };
    }
  } catch {
    // fall through to browser cache
  }

  return {
    drafts: loadLocalOutreachDrafts(searchJobId),
    status: {
      storage: "browser",
      supported: false,
    },
  };
}

export async function persistOutreachDraftWithFallback(record: OutreachDraftRecord): Promise<{
  drafts: OutreachDraftRecord[];
  status: OutreachDraftStoreStatus;
}> {
  try {
    const response = await fetch("/api/outreach-drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
    });
    const payload = (await response.json()) as OutreachDraftApiPayload;

    if (response.ok && payload.ok && payload.supported && payload.drafts) {
      return {
        drafts: payload.drafts,
        status: {
          storage: payload.storage,
          supported: payload.supported,
        },
      };
    }
  } catch {
    // fall through to browser cache
  }

  return {
    drafts: persistLocalOutreachDraft(record),
    status: {
      storage: "browser",
      supported: false,
    },
  };
}
