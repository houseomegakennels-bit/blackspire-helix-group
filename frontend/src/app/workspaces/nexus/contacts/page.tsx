import Image from "next/image";

import { StatusPill } from "@/components/buyer-shell";
import { NexusShell } from "@/components/nexus-shell";
import { brandAssets } from "@/lib/brand-assets";
import { getNexusSnapshot, getNexusStoredContactProfile } from "@/lib/nexus-server";

export const dynamic = "force-dynamic";

export default async function NexusContactsPage({
  searchParams,
}: {
  searchParams?: Promise<{ lead?: string }>;
}) {
  const snapshot = await getNexusSnapshot();
  const params = (await searchParams) ?? {};
  const selectedLeadId = params.lead?.trim();
  const focusLead = (selectedLeadId ? snapshot.leads.find((lead) => lead.id === selectedLeadId) : null) ?? snapshot.leads[0] ?? null;
  const contactProfile = focusLead ? getNexusStoredContactProfile(focusLead) : null;

  return (
    <NexusShell>
      <section className="brand-panel overflow-hidden px-6 py-8">
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Contact Profile</p>
            <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">{focusLead?.owner ?? "No lead selected"}</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              Nexus turns raw skip-trace output into a human-usable contact profile with confidence, compliance cues, and an operator-ready first-touch recommendation.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <StatusPill tone={contactProfile?.primary_phone ? "good" : "warn"} label={contactProfile?.primary_phone ? "phone found" : "phone missing"} />
              <StatusPill tone={contactProfile?.primary_email ? "good" : "neutral"} label={contactProfile?.primary_email ? "email found" : "email missing"} />
              <StatusPill tone="active" label={`confidence ${contactProfile?.contact_confidence_score ?? 0}`} />
            </div>
          </div>
          <div className="brand-card overflow-hidden p-5">
            <div className="relative mx-auto h-[188px] w-full max-w-[268px]">
              <Image
                src={brandAssets.nexus.logo}
                alt={brandAssets.nexus.name}
                fill
                priority
                className="object-contain"
                sizes="268px"
              />
            </div>
            <div className="mt-4 text-center text-sm leading-7 text-[var(--copy-soft)]">
              Provider signal is only step one. Nexus frames the best decision-maker path before outreach begins.
            </div>
          </div>
        </div>
        <div className="brand-hairline mt-8" />
        {focusLead ? (
          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            <div className="brand-card p-5">
              <div className="space-y-3 text-sm text-[var(--copy-soft)]">
                <div>Owner name: <span className="font-semibold text-white">{focusLead.owner}</span></div>
                <div>Property address: <span className="font-semibold text-white">{focusLead.property}</span></div>
                <div>Mailing address: <span className="font-semibold text-white">{focusLead.mailingAddress}</span></div>
                <div>Provider: <span className="font-semibold text-white">{focusLead.provider}</span></div>
                <div>Recommended contact method: <span className="font-semibold text-white">{contactProfile?.recommendedContactMethod ?? "Awaiting provider response"}</span></div>
                <div className="pt-3 text-sm leading-7 text-[var(--copy-soft)]">
                  {contactProfile?.aiContactStrategy ?? "This lead has a strong seller score and a high-confidence mobile number. Recommended first touch: call between 5 PM and 7 PM, then follow with SMS if compliant."}
                </div>
              </div>
            </div>
            <div className="brand-card p-5">
              <div className="space-y-3 text-sm text-[var(--copy-soft)]">
                <div>Primary phone: <span className="font-semibold text-white">{contactProfile?.primary_phone ?? "Not captured"}</span></div>
                <div>Secondary phone: <span className="font-semibold text-white">{contactProfile?.secondary_phone ?? "Not captured"}</span></div>
                <div>Primary email: <span className="font-semibold text-white">{contactProfile?.primary_email ?? "Not captured"}</span></div>
                <div>Confidence score: <span className="font-semibold text-white">{contactProfile?.contact_confidence_score ?? 0}</span></div>
                <div>DNC flag: <span className="font-semibold text-white">{String(contactProfile?.dnc_flag ?? "unknown")}</span></div>
              </div>
              <details className="mt-5 rounded-[16px] border border-[var(--line)] px-4 py-4">
                <summary className="cursor-pointer text-sm font-semibold text-white">Raw response</summary>
                <pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[var(--copy-soft)]">
                  {JSON.stringify(contactProfile?.raw_skiptrace_response ?? { note: "Placeholder until live provider response is stored." }, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        ) : null}
      </section>
    </NexusShell>
  );
}
