import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// This is a closed query client, not a wrapper exposing a privileged SDK client.
// No SDK, RPC, storage, auth refresh or arbitrary URL is reachable through it.
const projections: Record<string, string[]> = {
  seller_leads: ["id,status,motivation_score,lead_category,motivation_reasons,recommended_action,ai_summary,created_at,owners(name,mailing_address,mailing_state),properties(id,property_address,parcel_id,county,city,state,zip_code,property_type,assessed_value,estimated_equity,years_owned,tax_delinquent,foreclosure,probate,vacant,code_violation,owner_occupancy_status,data_sources(name,source_type,integration_type,source_url))"],
  BuyerProfile: ["id,buyer_name,county,state,is_llc,is_cash_buyer,purchase_count,total_spend,last_purchase_date,property_types,score", "id"],
  buyer_group_registry: ["id,canonical_name,group_type,aliases,states,counties,website,notes,active,created_at,updated_at"],
  deal_leads: ["property_address,county,city,property_type", "seller_lead_id,owner_name,property_address", "id,owner_name,property_address,county,status,motivation_score,recommended_next_action,deal_analysis(maximum_allowable_offer,assignment_fee_target),seller_conversations(next_action),buyer_matches(exit_strategy)"],
  deal_analysis: ["estimated_arv,purchase_price_target,seller_asking_price,repair_estimate,closing_costs,holding_costs,buyer_profit_target,assignment_fee_target,rental_estimate,flip_estimate,wholesale_spread,maximum_allowable_offer,deal_rating"],
  nexus_contacts: ["id,seller_lead_id,owner_name,property_address,primary_phone,contact_confidence_score,provider,status,updated_at"],
};
const columns: Record<string, string[]> = {
  seller_leads: ["motivation_score", "id"], BuyerProfile: ["id", "buyer_name", "county", "state", "is_llc", "is_cash_buyer", "purchase_count", "property_types"],
  buyer_group_registry: ["canonical_name", "active"], deal_leads: ["id", "motivation_score"], deal_analysis: ["lead_id"],
  nexus_contacts: ["seller_lead_id", "owner_name", "property_address", "updated_at", "id"],
};
const embeds: Record<string, string[]> = { seller_leads: ["owners", "properties", "properties.data_sources"], deal_leads: ["deal_analysis", "seller_conversations", "buyer_matches"] };
type Result = { data: unknown; count: number | null; error: null };

export function createCapabilityReadScope({ origin, key, releaseSha = null, receiverAuthorityDigest = null, fetchImpl = fetch }: {
  origin: string; key: string; releaseSha?: string | null; receiverAuthorityDigest?: string | null; fetchImpl?: typeof fetch;
}) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname) || !key || key.length > 8192) throw new Error("READ_CONFIGURATION_REJECTED");
  const started = performance.now(); let closed = false; let failures = 0; let requests = 0; let responseBytes = 0; let pending = 0;
  const abort = new AbortController();
  const reject = (): never => { failures++; abort.abort(); throw new Error("CAPABILITY_READ_REJECTED"); };
  const active = () => { if (closed || failures || performance.now() - started > 10000) reject(); };
  const exactOptions = (options: unknown, allowed: string[]) => {
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((k) => !allowed.includes(k))) reject();
    return options as Record<string, unknown>;
  };
  function from(table: string) {
    active(); if (typeof table !== "string" || !Object.hasOwn(projections, table)) return reject();
    const query = new URLSearchParams(); let head = false; let single = false; let execution: Promise<Result> | null = null;
    const mutate = () => { active(); if (execution) reject(); };
    const fields = (field: unknown) => { if (typeof field !== "string" || !columns[table].includes(field)) reject(); return String(field); };
    const value = (v: unknown) => { if (!["string", "number", "boolean"].includes(typeof v) || String(v).length > 256 || /[\x00-\x1f]/.test(String(v))) reject(); return String(v); };
    const methods: Record<string, unknown> = {
      select(selection: string, options?: unknown) {
        mutate(); if (typeof selection !== "string" || query.has("select")) return reject();
        const normalized = selection.replace(/\s/g, ""); if (!projections[table].includes(normalized)) return reject();
        if (options !== undefined) {
          const opts = exactOptions(options, ["head", "count"]);
          if (opts.head !== true || opts.count !== "exact" || table !== "BuyerProfile" || normalized !== "id") return reject();
          head = true;
        }
        query.set("select", normalized); return facade;
      },
      eq(field: string, v: unknown) { mutate(); query.append(fields(field), `eq.${value(v)}`); return facade; },
      ilike(field: string, v: unknown) { mutate(); if (typeof v !== "string") return reject(); query.append(fields(field), `ilike.${value(v)}`); return facade; },
      contains(field: string, v: unknown) {
        mutate(); if (table !== "BuyerProfile" || field !== "property_types" || !Array.isArray(v) || v.length !== 1 || typeof v[0] !== "string" || !/^[a-z_ -]{1,64}$/.test(v[0])) return reject();
        query.append(field, `cs.{${v[0]}}`); return facade;
      },
      order(field: string, options: unknown = {}) {
        mutate(); const opts = exactOptions(options, ["ascending", "nullsFirst"]);
        if (Object.values(opts).some((v) => typeof v !== "boolean")) return reject();
        const order = `${fields(field)}.${opts.ascending === false ? "desc" : "asc"}${opts.nullsFirst === undefined ? "" : opts.nullsFirst ? ".nullsfirst" : ".nullslast"}`;
        query.set("order", [query.get("order"), order].filter(Boolean).join(",")); return facade;
      },
      limit(n: number, options?: unknown) {
        mutate(); if (!Number.isSafeInteger(n) || n < 1 || n > (table === "buyer_group_registry" ? 201 : table === "BuyerProfile" ? 200 : 10)) return reject();
        let name = "limit";
        if (options !== undefined) {
          const opts = exactOptions(options, ["referencedTable"]);
          if (typeof opts.referencedTable !== "string" || !embeds[table]?.includes(opts.referencedTable) || n !== 1) return reject();
          name = `${opts.referencedTable}.limit`;
        }
        query.set(name, String(n)); return facade;
      },
      maybeSingle() { mutate(); single = true; if (query.get("limit") !== "1") return reject(); return facade; },
      then(resolve: (v: Result) => unknown, rejectPromise: (e: unknown) => unknown) {
        execution ??= execute(); return execution.then(resolve, rejectPromise);
      },
    };
    const facade = new Proxy(Object.freeze(methods), { get(target, name) {
      if (typeof name !== "string" || !Object.hasOwn(target, name)) return reject(); return target[name];
    } });
    async function execute(): Promise<Result> {
      active(); if (!query.has("select") || (!head && !query.has("limit")) || ++requests > 12) return reject();
      // All reviewed embeds are bounded independently of the parent limit.
      for (const embed of embeds[table] ?? []) if (query.get("select")!.includes(`${embed.split('.').at(-1)}(`)) query.set(`${embed}.limit`, "1");
      if ([...query].length > 64 || query.toString().length > 8192) return reject();
      const url = new URL(`/rest/v1/${table}`, origin); url.search = query.toString(); pending++;
      try {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.min(4000, Math.floor(10000 - (performance.now() - started)))))]);
        const response = await fetchImpl(url, { method: head ? "HEAD" : "GET", redirect: "error", cache: "no-store", signal,
          headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json", ...(head ? { prefer: "count=exact" } : {}) } });
        if (!response.ok || response.redirected) return reject();
        if (head) {
          const match = response.headers.get("content-range")?.match(/\/(\d+)$/); const count = match ? Number(match[1]) : NaN;
          if (!Number.isSafeInteger(count) || count < 0) return reject();
          return { data: null, count, error: null };
        }
        if (!response.body) return reject();
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.length; responseBytes += part.value.length;
            if (size > 1024 * 1024 || responseBytes > 2 * 1024 * 1024) return reject(); chunks.push(part.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        active(); const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!Array.isArray(data) || data.length > Number(query.get("limit"))) return reject();
        for (const row of data) {
          if (!row || typeof row !== "object" || Array.isArray(row)) return reject();
          for (const embed of embeds[table] ?? []) {
            let joined: unknown = row;
            for (const field of embed.split('.')) {
              if (Array.isArray(joined)) { if (joined.length > 1) return reject(); joined = joined[0]; }
              joined = joined && typeof joined === "object" ? (joined as Record<string, unknown>)[field] : null;
            }
            if (Array.isArray(joined) && joined.length > 1) return reject();
          }
        }
        return { data: single ? data[0] ?? null : data, count: null, error: null };
      } catch { return reject(); } finally { pending--; }
    }
    return facade;
  }
  const client = new Proxy(Object.freeze({ from }), { get(target, name) {
    if (name !== "from") return reject(); return target.from;
  } }) as unknown as SupabaseClient;
  function observation() {
    active(); if (pending || !requests) return reject();
    return Object.freeze({ version: 1, releaseSha: /^[a-f0-9]{40}$/.test(releaseSha ?? "") ? releaseSha : null,
      transport: "bounded PostgREST GET/HEAD", requests, responseBytes, forbiddenAttempts: failures,
      latencyMs: Math.ceil(performance.now() - started), scope: "supplied read client only" });
  }
  function respond(body: unknown) {
    const evidence = observation(); closed = true; abort.abort();
    const headers: Record<string,string> = { "cache-control": "no-store", "x-zola-read-observation": JSON.stringify(evidence) };
    if (/^[a-f0-9]{64}$/.test(receiverAuthorityDigest ?? "")) headers["x-blackspire-authority-binding"] = receiverAuthorityDigest!;
    return Response.json(body, { headers });
  }
  return Object.freeze({ client, observation, respond });
}

export function productionCapabilityReadScope(receiverAuthorityDigest: string) {
  return createCapabilityReadScope({ origin: process.env.SUPABASE_URL?.trim() ?? "", key: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
    releaseSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? null, receiverAuthorityDigest });
}
