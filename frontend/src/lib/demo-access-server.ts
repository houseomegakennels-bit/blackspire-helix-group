import "server-only";

import { createClient } from "@supabase/supabase-js";

function admin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function countRows(table: string) {
  const client = admin();
  if (!client) return 0;
  const { count } = await client.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

export type DemoSnapshot = {
  capturedAt: string;
  metrics: {
    harvestedIntakes: number;
    sellerLeads: number;
    activeDeals: number;
    buyerReports: number;
    sentinelItems: number;
  };
  buyers: Array<{ name: string; purchases: number; score: number; entity: boolean; cash: boolean }>;
};

export async function getDemoSnapshot(): Promise<DemoSnapshot> {
  const client = admin();
  const [harvestedIntakes, sellerLeads, activeDeals, buyerReports, sentinelItems] = await Promise.all([
    countRows("harvester_intakes"),
    countRows("seller_leads"),
    countRows("deal_leads"),
    countRows("BuyerReport"),
    countRows("sentinel_inbox_items"),
  ]);

  const { data } = client
    ? await client
        .from("BuyerReport")
        .select("buyer_name_snapshot,purchase_count,score,is_llc,is_cash_buyer")
        .or("is_llc.eq.true,is_cash_buyer.eq.true")
        .order("score", { ascending: false })
        .limit(8)
    : { data: [] };

  return {
    capturedAt: new Date().toISOString(),
    metrics: { harvestedIntakes, sellerLeads, activeDeals, buyerReports, sentinelItems },
    buyers: (data ?? []).map((row) => ({
      name: String(row.buyer_name_snapshot || "Verified buyer entity"),
      purchases: Number(row.purchase_count || 0),
      score: Number(row.score || 0),
      entity: Boolean(row.is_llc),
      cash: Boolean(row.is_cash_buyer),
    })),
  };
}
