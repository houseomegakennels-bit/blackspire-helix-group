"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { BuyerShell, Panel, StatusPill } from "@/components/buyer-shell";
import {
  getCountyCapability,
  getCountyLaunchBlock,
  getCountyOperationalRisk,
  getCountyVerificationTone,
  type CountyCapability,
} from "@/lib/buyer-engine-data";
import type { OperatorShellStatus } from "@/lib/buyer-engine-server";

export function NewSearchForm({
  initialCountyOptions,
  countyLoadError,
  operatorStatus,
}: {
  initialCountyOptions: CountyCapability[];
  countyLoadError?: string | null;
  operatorStatus?: OperatorShellStatus | null;
}) {
  const router = useRouter();
  const [countyOptions] = useState<CountyCapability[]>(initialCountyOptions);
  const [form, setForm] = useState({
    title: "Robeson County land buyers sweep",
    state: "NC",
    county: "Robeson",
    propertyType: "land",
    dateRangeStart: "2024-01-01",
    dateRangeEnd: "2024-12-31",
    notes: "Frontend intake path wired before workflow trigger step.",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const operatorGate = useMemo(() => {
    if (!operatorStatus) return null;
    if (operatorStatus.requiresAuth) {
      return "Sign in through /auth before launching a buyer sweep. Operator accounts already exist for this project.";
    }
    if (operatorStatus.bootstrapRequired) {
      return "Bootstrap the first operator through /auth before turning Buyer Engine into normal operator mode.";
    }
    return null;
  }, [operatorStatus]);

  const countyDetails = useMemo(
    () => getCountyCapability(form.county, countyOptions) ?? countyOptions[0],
    [countyOptions, form.county],
  );
  const countyRisk = useMemo(
    () => getCountyOperationalRisk(form.county, form.propertyType),
    [form.county, form.propertyType],
  );
  const approvedCounties = useMemo(
    () =>
      countyOptions.filter(
        (county) =>
          county.status === "active" &&
          county.supportsPast90Days &&
          !getCountyLaunchBlock(county.county, form.propertyType, countyOptions).blocked,
      ),
    [countyOptions, form.propertyType],
  );
  const limitedCounties = useMemo(
    () =>
      countyOptions.filter(
        (county) => county.status === "active" && !county.supportsPast90Days && county.verificationStatus !== "blocked",
      ),
    [countyOptions],
  );
  const blockedCounties = useMemo(
    () =>
      countyOptions.filter(
        (county) =>
          county.status === "inactive" || getCountyLaunchBlock(county.county, form.propertyType, countyOptions).blocked,
      ),
    [countyOptions, form.propertyType],
  );

  const launchGuard = useMemo(() => {
    const rangeStart = new Date(form.dateRangeStart);
    const rangeEnd = new Date(form.dateRangeEnd);
    const isValidRange =
      !Number.isNaN(rangeStart.getTime()) &&
      !Number.isNaN(rangeEnd.getTime()) &&
      rangeStart <= rangeEnd;

    if (!isValidRange) {
      return {
        blocked: true,
        message: "Choose a valid chronological date range before launching the search.",
      };
    }

    const countyLaunchBlock = getCountyLaunchBlock(form.county, form.propertyType, countyOptions);
    if (countyLaunchBlock.blocked) {
      return {
        blocked: true,
        message: countyLaunchBlock.reason,
      };
    }

    return {
      blocked: false,
      message: "",
    };
  }, [countyOptions, form]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const response = await fetch("/api/search-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
        job?: {
          id: string;
        };
      };

      if (!response.ok || !payload.ok) {
        setResult({
          ok: false,
          message: payload.error ?? "Search job creation failed.",
        });
        return;
      }

      setResult({
        ok: true,
        message: payload.message ?? "Search job stored.",
      });

      if (payload.job?.id) {
        router.push(`/searches?highlight=${encodeURIComponent(payload.job.id)}`);
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Unexpected network failure.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BuyerShell
      eyebrow="Intelligence Sweep"
      title="New Buyer Search"
      description="This is the first operator workflow we need wired for real. The payload shape already matches the live n8n webhook and SearchJob model."
      operatorStatus={operatorStatus}
    >
      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel
          eyebrow="Search Intake"
          title="Job payload shape"
          description="This form now creates a live SearchJob, then queues the Buyer Engine webhook after the response returns."
        >
          <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit}>
            <Field
              label="Search title"
              value={form.title}
              onChange={(value) => setForm((current) => ({ ...current, title: value }))}
            />
            <Field
              label="State"
              value={form.state}
              onChange={(value) => setForm((current) => ({ ...current, state: value.toUpperCase() }))}
            />
            <SelectField
              label="County"
              optionGroups={[
                {
                  label: `90-day ready counties (${approvedCounties.length})`,
                  options: approvedCounties.map((county) => county.county),
                },
                {
                  label: `Active but limited / historical (${limitedCounties.length})`,
                  options: limitedCounties.map((county) => county.county),
                },
                {
                  label: `Blocked counties (${blockedCounties.length})`,
                  options: blockedCounties.map((county) => county.county),
                },
              ]}
              value={form.county}
              onChange={(value) => setForm((current) => ({ ...current, county: value }))}
            />
            <SelectField
              label="Property type"
              optionGroups={[
                {
                  label: "Property types",
                  options: ["land", "single_family", "multi_family", "commercial", "mobile_home", "all"],
                },
              ]}
              value={form.propertyType}
              onChange={(value) => setForm((current) => ({ ...current, propertyType: value }))}
            />
            <Field
              label="Date range start"
              value={form.dateRangeStart}
              onChange={(value) => setForm((current) => ({ ...current, dateRangeStart: value }))}
            />
            <Field
              label="Date range end"
              value={form.dateRangeEnd}
              onChange={(value) => setForm((current) => ({ ...current, dateRangeEnd: value }))}
            />
            <Field label="Min purchases" value="2" readOnly />
            <Field label="Workflow path" value="/webhook/buyer-engine" readOnly />
            <TextAreaField
              label="Operator notes"
              value={form.notes}
              onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
            />

            <div className="brand-card brand-copy-soft md:col-span-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill
                  tone={launchGuard.blocked || Boolean(operatorGate) ? "bad" : "good"}
                  label={launchGuard.blocked || operatorGate ? "launch blocked" : "launchable"}
                />
                <StatusPill tone={countyRisk.tone} label={countyRisk.label} />
                {countyDetails ? (
                  <StatusPill
                    tone={getCountyVerificationTone(countyDetails.verificationStatus)}
                    label={
                      countyDetails.verificationStatus === "approved"
                        ? "90-day ready"
                        : countyDetails.verificationStatus.replace(/_/g, " ")
                    }
                  />
                ) : null}
                {form.county.toLowerCase() === "wake" && form.propertyType.toLowerCase() === "land" ? (
                  <StatusPill tone="good" label="wake prefetch path" />
                ) : null}
              </div>
              <p className="brand-copy-soft mt-3 leading-6">{countyRisk.message}</p>
              {countyDetails ? (
                <p className="mt-3 leading-6 text-[var(--copy-soft)]">{countyDetails.verificationReason}</p>
              ) : null}
              {launchGuard.message ? (
                <p className="mt-3 leading-6 text-[hsl(22_100%_72%)]">{launchGuard.message}</p>
              ) : null}
              {operatorGate ? (
                <p className="mt-3 leading-6 text-[hsl(22_100%_72%)]">{operatorGate}</p>
              ) : null}
              {countyLoadError ? (
                <p className="mt-3 leading-6 text-[var(--gold)]">{countyLoadError}</p>
              ) : null}
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={submitting || launchGuard.blocked || Boolean(operatorGate)}
                className="brand-button px-4 py-2 text-sm font-medium text-[var(--gold)] disabled:opacity-60"
              >
                {submitting ? "Launching buyer sweep..." : "Launch Buyer Sweep"}
              </button>
              {result ? (
                <span className={`text-sm ${result.ok ? "text-[var(--gold-soft)]" : "text-[hsl(22_100%_72%)]"}`}>
                  {result.message}
                </span>
              ) : null}
            </div>
          </form>
        </Panel>

        <Panel
          eyebrow="Trigger Contract"
          title="Backend path to implement"
          description="The remaining work here is mostly quality-of-operations work: better county heuristics, realtime, exports, and outreach actions."
        >
          <ol className="brand-copy-soft space-y-3 text-sm leading-6">
            <li className="brand-card p-4">1. SearchJob insert and webhook dispatch are live.</li>
            <li className="brand-card p-4">2. Wake County land runs now prefetch raw sales in the app server before n8n scoring.</li>
            <li className="brand-card p-4">3. Realtime subscriptions can replace polling once the base operator flow settles.</li>
            <li className="brand-card p-4">4. Export and AI outreach actions are the next user-visible step after queue stability.</li>
          </ol>

          <div className="mt-5 flex flex-wrap gap-3">
            <StatusPill tone="good" label="Wake prefetch active" />
            <StatusPill tone="good" label="Durham stabilized" />
            <StatusPill tone="active" label={`${countyOptions.filter((county) => county.status === "active").length} active counties`} />
          </div>

          <div className="mt-5 grid gap-3">
            <div className="brand-card brand-copy-soft p-4 text-sm leading-6">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">90-Day County Sections</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill tone="good" label={`${approvedCounties.length} ready`} />
                <StatusPill tone="warn" label={`${limitedCounties.length} limited`} />
                <StatusPill tone="bad" label={`${blockedCounties.length} blocked`} />
              </div>
              <p className="mt-3 text-[var(--copy-soft)]">
                Approved counties can be marketed as past-90-day ready. Limited counties remain visible but are not approved for true 90-day buyer sweeps.
              </p>
            </div>

            <div className="brand-card brand-copy-soft p-4 text-sm leading-6">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Selected County</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div>Source: <span className="font-mono text-xs text-[var(--copy-soft)]">{countyDetails?.sourceTypes.join(", ") ?? "n/a"}</span></div>
                <div>Date shape: <span>{countyDetails?.dateFormats.join(", ") ?? "unknown"}</span></div>
                <div>Rows: <span>{countyDetails?.sourceRowCount ?? 0}</span></div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>90-day status: <span>{countyDetails?.verificationStatus.replace(/_/g, " ") ?? "unknown"}</span></div>
                <div>State: <span>{countyDetails?.state ?? form.state}</span></div>
              </div>
              <div className="mt-3">
                <span className="text-[var(--copy-muted)]">Reason:</span>{" "}
                <span>{countyDetails?.verificationReason ?? "No county capability metadata available."}</span>
              </div>
              <div className="mt-3">
                <span className="text-[var(--copy-muted)]">Notes:</span>{" "}
                <span>{countyDetails?.notes[0] ?? "Standard county path"}</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </BuyerShell>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{label}</span>
      <input
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="brand-input w-full px-3 py-2 text-sm outline-none"
      />
    </label>
  );
}

function SelectField({
  label,
  optionGroups,
  value,
  onChange,
}: {
  label: string;
  optionGroups: Array<{ label: string; options: string[] }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="brand-input w-full px-3 py-2 text-sm outline-none"
      >
        {optionGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2 md:col-span-2">
      <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="brand-input w-full px-3 py-2 text-sm outline-none"
      />
    </label>
  );
}
