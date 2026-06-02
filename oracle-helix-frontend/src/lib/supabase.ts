import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://lypvyxzcudkivgfwxffx.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5cHZ5eHpjdWRraXZnZnd4ZmZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MjcxOTQsImV4cCI6MjA5NTUwMzE5NH0.bz33CXi-Uy8-T_JffxlO2DgW4ufugNVhNGZrSMZSgFQ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
