import Image from "next/image";

import { StatusPill } from "@/components/buyer-shell";
import { NexusShell } from "@/components/nexus-shell";
import { brandAssets } from "@/lib/brand-assets";
import { getNexusSnapshot } from "@/lib/nexus-server";

export const dynamic = "force-dynamic";

export default async function NexusSettingsPage() {
  const { settings } = await getNexusSnapshot();

  return (
    <NexusShell>
      <section className="brand-panel overflow-hidden px-6 py-8">
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.42em] text-[var(--gold-soft)]">Admin Settings</p>
            <h2 className="brand-display mt-3 text-3xl text-white lg:text-4xl">Tracerfy and skip trace controls</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--copy-soft)]">
              Nexus settings govern when automatic skip trace is allowed, how credit usage is monitored, and whether operators can override the default qualification rules.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <StatusPill tone={settings.tracerfyEnabled ? "good" : "warn"} label={settings.tracerfyEnabled ? "provider enabled" : "provider disabled"} />
              <StatusPill tone={settings.apiKeyConfigured ? "good" : "warn"} label={settings.apiKeyConfigured ? "api ready" : "api missing"} />
            </div>
          </div>
          <div className="brand-card overflow-hidden p-5">
            <div className="relative mx-auto h-[172px] w-full max-w-[248px]">
              <Image
                src={brandAssets.nexus.logo}
                alt={brandAssets.nexus.name}
                fill
                priority
                className="object-contain"
                sizes="248px"
              />
            </div>
            <div className="mt-4 text-center text-sm leading-7 text-[var(--copy-soft)]">
              Purple for live signal, silver for verified structure, and no key material exposed in the UI.
            </div>
          </div>
        </div>
        <div className="brand-hairline mt-8" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            ["Enable/disable Tracerfy", String(settings.tracerfyEnabled)],
            ["Minimum seller score for auto skip trace", String(settings.minimumSellerScoreForAutoTrace)],
            ["Manual override", String(settings.manualOverride)],
            ["Credit alert threshold", String(settings.creditAlertThreshold)],
            ["Provider name", settings.providerName],
            ["API key status", settings.apiKeyConfigured ? "Configured" : "Missing"],
          ].map(([label, value]) => (
            <div key={label} className="brand-card p-5">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">{label}</div>
              <div className="mt-3 text-lg font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>
      </section>
    </NexusShell>
  );
}
