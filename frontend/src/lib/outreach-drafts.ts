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

const STORAGE_KEY = "blackspire-outreach-drafts-v1";
const MAX_DRAFTS = 12;

export function loadOutreachDrafts(searchJobId?: string) {
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

export function persistOutreachDraft(record: OutreachDraftRecord) {
  if (typeof window === "undefined") return [] as OutreachDraftRecord[];

  const next = [record, ...loadOutreachDrafts().filter((draft) => draft.id !== record.id)].slice(0, MAX_DRAFTS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
