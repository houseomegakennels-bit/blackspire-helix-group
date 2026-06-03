import { NextRequest, NextResponse } from "next/server";

import { isResendConfigured, sendReconEmail } from "@/lib/recon-engine/email";
import { listAlertRecipients, listRecentOpportunities } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  return auth === `Bearer ${secret}` || key === secret;
}

function buildDigestHtml(
  isSubscriber: boolean,
  opps: Array<{ title: string; agency: string | null; summary: string | null; originalUrl: string | null; deadline: string | null }>,
): string {
  const rows = opps
    .map((o) => {
      const summary = isSubscriber
        ? o.summary ?? ""
        : (o.summary ?? "").slice(0, 120) + ((o.summary?.length ?? 0) > 120 ? "…" : "");
      const link = o.originalUrl
        ? `<a href="${o.originalUrl}" style="color:#8b5cf6;">View opportunity</a>`
        : "";
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #222;">
        <div style="font-weight:600;color:#fff;">${o.title}</div>
        <div style="color:#999;font-size:12px;">${o.agency ?? ""}</div>
        <div style="color:#ccc;font-size:13px;margin-top:6px;">${summary}</div>
        <div style="margin-top:6px;">${link}</div>
      </td></tr>`;
    })
    .join("");

  const cta = isSubscriber
    ? ""
    : `<p style="margin-top:18px;"><a href="https://blackspirehelix.com/recon-engine#pricing" style="background:#8b5cf6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Unlock full reports →</a></p>`;

  return `<div style="font-family:Arial,sans-serif;background:#0b0b0f;padding:24px;color:#ddd;">
    <h2 style="color:#c4b5fd;">Blackspire Recon Engine — New Opportunities</h2>
    <p style="color:#aaa;">${isSubscriber ? "Your latest matched opportunities:" : "A preview of new opportunities we found:"}</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    ${cta}
    <p style="color:#666;font-size:11px;margin-top:24px;">Blackspire Helix Group · blackspirehelix.com</p>
  </div>`;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isResendConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Email alerts are not configured yet (missing RESEND_API_KEY)." },
      { status: 503 },
    );
  }

  try {
    const [recipients, opps] = await Promise.all([
      listAlertRecipients(500),
      listRecentOpportunities(8),
    ]);
    if (!opps.length || !recipients.length) {
      return NextResponse.json({ ok: true, sent: 0, recipients: recipients.length, opportunities: opps.length });
    }

    let sent = 0;
    const errors: string[] = [];
    for (const recipient of recipients) {
      const result = await sendReconEmail({
        to: recipient.email,
        subject: "New government opportunities for your business — Blackspire Recon Engine",
        html: buildDigestHtml(recipient.isSubscriber, opps),
      });
      if (result.ok) sent += 1;
      else if (result.error) errors.push(result.error);
    }

    return NextResponse.json({ ok: true, sent, recipients: recipients.length, errors: errors.slice(0, 5) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Send failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
