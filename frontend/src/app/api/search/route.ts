import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function admin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type GlobalSearchResult = {
  type: "property" | "deal" | "buyer" | "owner" | "contact";
  label: string;
  sublabel: string;
  href: string;
};

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const supabase = admin();
  if (!supabase) return NextResponse.json({ ok: true, results: [] });

  const like = `%${q}%`;
  // For phone queries, match against the normalized digits-only column so
  // "9105550123" finds "910-555-0123".
  const digits = q.replace(/\D/g, "");
  const phoneDigitsLike = digits.length >= 4 ? `%${digits}%` : `%${q}%`;
  const [properties, deals, buyers, owners, contacts] = await Promise.all([
    supabase.from("properties").select("id, property_address, city, county, parcel_id").or(`property_address.ilike.${like},parcel_id.ilike.${like}`).limit(6),
    supabase.from("deal_leads").select("id, property_address, owner_name, county").or(`property_address.ilike.${like},owner_name.ilike.${like}`).limit(6),
    supabase.from("BuyerProfile").select("id, buyer_name, county, purchase_count").ilike("buyer_name", like).order("purchase_count", { ascending: false, nullsFirst: false }).limit(6),
    supabase.from("owners").select("id, name, mailing_city, mailing_state").ilike("name", like).limit(5),
    supabase
      .from("nexus_contacts")
      .select("id, seller_lead_id, owner_name, property_address, primary_phone, primary_email")
      .or(`phone_digits.ilike.${phoneDigitsLike},primary_email.ilike.${like},owner_name.ilike.${like}`)
      .limit(6),
  ]);

  const results: GlobalSearchResult[] = [
    ...((properties.data ?? []).map((row) => ({
      type: "property" as const,
      label: (row.property_address as string) ?? "Property",
      sublabel: [row.city, row.county && `${row.county} County`].filter(Boolean).join(" · ") || "Property record",
      href: `/workspace/property/${row.id}`,
    }))),
    ...((deals.data ?? []).map((row) => ({
      type: "deal" as const,
      label: (row.property_address as string) ?? "Deal",
      sublabel: `Deal ${row.id}${row.owner_name ? ` · ${row.owner_name}` : ""}`,
      href: `/workspace/deal-engine/${row.id}`,
    }))),
    ...((buyers.data ?? []).map((row) => ({
      type: "buyer" as const,
      label: (row.buyer_name as string) ?? "Buyer",
      sublabel: `${row.county ?? ""} · ${row.purchase_count ?? 0} purchases`,
      href: `/workspace/buyer-engine`,
    }))),
    ...((owners.data ?? []).map((row) => ({
      type: "owner" as const,
      label: (row.name as string) ?? "Owner",
      sublabel: [row.mailing_city, row.mailing_state].filter(Boolean).join(", ") || "Seller / owner",
      href: `/seller-engine`,
    }))),
    ...((contacts.data ?? []).map((row) => ({
      type: "contact" as const,
      label: (row.owner_name as string) || (row.primary_phone as string) || "Contact",
      sublabel: [row.primary_phone, row.primary_email, row.property_address].filter(Boolean).join(" · ") || "Skip-trace contact",
      href: row.seller_lead_id ? `/workspace/nexus` : `/seller-engine`,
    }))),
  ];

  return NextResponse.json({ ok: true, results });
}
