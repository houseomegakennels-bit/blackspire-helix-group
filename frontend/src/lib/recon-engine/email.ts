import "server-only";

/**
 * Recon Engine email (Resend). Env-driven: no-ops cleanly until RESEND_API_KEY
 * (and optionally RESEND_FROM) are configured.
 */

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function getFrom(): string {
  return process.env.RESEND_FROM?.trim() || "Blackspire Recon Engine <recon@blackspirehelix.com>";
}

export async function sendReconEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured." };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: getFrom(),
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend failed (${res.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "send failed" };
  }
}
