"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

type BuyerEngineRealtimeConfig = {
  url: string;
  anonKey: string;
};

let cachedClient: SupabaseClient | null = null;
let cachedKey = "";

export function getBuyerEngineRealtimeConfig(): BuyerEngineRealtimeConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  return { url, anonKey };
}

export function getBuyerEngineBrowserClient(config?: BuyerEngineRealtimeConfig | null) {
  const resolved = config ?? getBuyerEngineRealtimeConfig();
  if (!resolved) return null;

  const cacheKey = `${resolved.url}:::${resolved.anonKey}`;
  if (!cachedClient || cachedKey !== cacheKey) {
    cachedClient = createClient(resolved.url, resolved.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedKey = cacheKey;
  }

  return cachedClient;
}

export function buildRealtimeChannelName(scope: string) {
  return `blackspire-${scope}-${Math.random().toString(36).slice(2, 10)}`;
}

export function removeRealtimeChannel(
  supabase: SupabaseClient | null,
  channel: RealtimeChannel | null,
) {
  if (!supabase || !channel) return;
  void supabase.removeChannel(channel);
}
