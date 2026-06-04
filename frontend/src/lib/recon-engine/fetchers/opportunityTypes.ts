export type NormalizedOpportunity = {
  sourceName: string;
  title: string;
  agency: string | null;
  location: string | null;
  deadline: string | null; // ISO timestamp
  category: string | null;
  description: string | null;
  originalUrl: string | null;
  documentUrl: string | null;
  rawText: string | null;
};
