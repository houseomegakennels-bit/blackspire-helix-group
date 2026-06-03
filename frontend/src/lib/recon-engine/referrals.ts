/**
 * Recon Engine referral primitives.
 * Reward rule: 1 successful referral = 1 free month.
 *
 * Phase note: inbound referral codes are captured at the lead stage (the free
 * scan stores `referral_code`). Per-user code generation and automatic reward
 * granting activate with the Recon accounts/auth layer.
 */

export const REFERRAL_REWARD = "1 free month per successful referral";

/** Deterministic short referral code from a seed (e.g., an email or user id). */
export function generateReferralCode(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const base = Math.abs(hash).toString(36).toUpperCase().slice(0, 6).padStart(6, "0");
  return `BRE-${base}`;
}

export function buildReferralLink(code: string, origin = "https://blackspirehelix.com"): string {
  return `${origin}/recon-engine?ref=${encodeURIComponent(code)}`;
}

/** Pull a referral code from a URL search param value. */
export function normalizeReferralCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 32);
}
