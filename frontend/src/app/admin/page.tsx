import { BuyerShell, Metric, Panel, StatusPill } from "@/components/buyer-shell";
import {
  getBetaTesterSnapshot,
  getOperatorShellStatus,
} from "@/lib/buyer-engine-server";

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default async function AdminPage() {
  const operatorStatus = await getOperatorShellStatus().catch(() => null);

  let snapshot:
    | Awaited<ReturnType<typeof getBetaTesterSnapshot>>
    | null = null;
  let accessError: string | null = null;

  try {
    snapshot = await getBetaTesterSnapshot();
  } catch (error) {
    accessError = error instanceof Error ? error.message : "Admin data could not be loaded.";
  }

  return (
    <BuyerShell
      eyebrow="Admin"
      title="Beta Tracker"
      description="This surface keeps beta signup activity, tester usage, and county traction visible to the admin operator only."
      operatorStatus={operatorStatus}
    >
      {accessError ? (
        <Panel
          eyebrow="Restricted"
          title="Admin access only"
          description="This page is reserved for the bootstrap owner account."
        >
          <div className="brand-card p-4 text-sm leading-6 text-[hsl(22_100%_72%)]">
            {accessError}
          </div>
        </Panel>
      ) : null}

      {snapshot ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Beta Testers"
              value={String(snapshot.analytics.totalTesters)}
              detail="All non-admin auth users currently in the beta pool"
            />
            <Metric
              label="Active 7 Days"
              value={String(snapshot.analytics.activeLast7Days)}
              detail="Testers who launched at least one search job recently"
            />
            <Metric
              label="Signed In 7 Days"
              value={String(snapshot.analytics.signedInLast7Days)}
              detail="Recent auth activity across the beta cohort"
            />
            <Metric
              label="Avg Jobs / Tester"
              value={String(snapshot.analytics.averageJobsPerTester)}
              detail={`${snapshot.analytics.totalJobs} total jobs across the beta pool`}
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Panel
              eyebrow="Usage"
              title="Beta analysis"
              description="This is the top-line operating picture for how testers are using the product."
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Completed jobs</div>
                  <div className="brand-accent-text mt-2 text-2xl font-semibold">
                    {snapshot.analytics.completedJobs}
                  </div>
                </div>
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Failed jobs</div>
                  <div className="brand-accent-text mt-2 text-2xl font-semibold">
                    {snapshot.analytics.failedJobs}
                  </div>
                </div>
                <div className="brand-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--copy-muted)]">Total jobs</div>
                  <div className="brand-accent-text mt-2 text-2xl font-semibold">
                    {snapshot.analytics.totalJobs}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div className="brand-card p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Top counties</div>
                  <div className="mt-3 space-y-2">
                    {snapshot.analytics.topCounties.length ? snapshot.analytics.topCounties.map((item) => (
                      <div key={item.county} className="flex items-center justify-between gap-3 text-sm text-[var(--copy-soft)]">
                        <span>{item.county}</span>
                        <StatusPill tone="good" label={`${item.jobs} jobs`} />
                      </div>
                    )) : <p className="text-sm text-[var(--copy-soft)]">No county usage yet.</p>}
                  </div>
                </div>

                <div className="brand-card p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Top companies</div>
                  <div className="mt-3 space-y-2">
                    {snapshot.analytics.topCompanies.length ? snapshot.analytics.topCompanies.map((item) => (
                      <div key={item.company} className="flex items-center justify-between gap-3 text-sm text-[var(--copy-soft)]">
                        <span>{item.company}</span>
                        <StatusPill tone="neutral" label={`${item.testers} testers`} />
                      </div>
                    )) : <p className="text-sm text-[var(--copy-soft)]">No company data yet.</p>}
                  </div>
                </div>

                <div className="brand-card p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Top use cases</div>
                  <div className="mt-3 space-y-2">
                    {snapshot.analytics.topUseCases.length ? snapshot.analytics.topUseCases.map((item) => (
                      <div key={item.useCase} className="flex items-center justify-between gap-3 text-sm text-[var(--copy-soft)]">
                        <span className="pr-2">{item.useCase}</span>
                        <StatusPill tone="warn" label={`${item.testers} testers`} />
                      </div>
                    )) : <p className="text-sm text-[var(--copy-soft)]">No use-case data yet.</p>}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel
              eyebrow="Cohort"
              title="Tester roster"
              description="Each row reflects auth signup metadata plus live job behavior."
            >
              <div className="space-y-3">
                {snapshot.testers.length ? snapshot.testers.map((tester) => (
                  <div key={tester.id} className="brand-card p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-white">
                            {tester.fullName ?? tester.email ?? tester.id}
                          </h3>
                          <StatusPill
                            tone={tester.totalJobs > 0 ? "good" : "neutral"}
                            label={tester.totalJobs > 0 ? "launched" : "idle"}
                          />
                          {tester.accessSource ? (
                            <StatusPill tone="warn" label={tester.accessSource.replaceAll("_", " ")} />
                          ) : (
                            <StatusPill tone="neutral" label="manual / legacy" />
                          )}
                        </div>
                        <div className="text-sm text-[var(--copy-soft)]">
                          {tester.email ?? "No email exposed"}
                        </div>
                        {tester.company ? (
                          <div className="text-sm text-[var(--copy-soft)]">{tester.company}</div>
                        ) : null}
                        {tester.useCase ? (
                          <p className="text-sm leading-6 text-[var(--copy-soft)]">{tester.useCase}</p>
                        ) : null}
                      </div>

                      <dl className="min-w-72 space-y-1 text-sm text-[var(--copy-soft)]">
                        <div className="flex justify-between gap-4">
                          <dt>Created</dt>
                          <dd className="text-white">{formatDateTime(tester.createdAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Last sign-in</dt>
                          <dd className="text-white">{formatDateTime(tester.lastSignInAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Jobs</dt>
                          <dd className="text-white">{tester.totalJobs}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Completed</dt>
                          <dd className="text-white">{tester.completedJobs}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Failed</dt>
                          <dd className="text-white">{tester.failedJobs}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Buyers found</dt>
                          <dd className="text-white">{tester.totalBuyersFound}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Sales analyzed</dt>
                          <dd className="text-white">{tester.totalSalesAnalyzed}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Latest county</dt>
                          <dd className="text-white">{tester.latestCounty ?? "None"}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                )) : (
                  <div className="brand-card p-4 text-sm leading-6 text-[var(--copy-soft)]">
                    No beta tester accounts exist yet.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </>
      ) : null}
    </BuyerShell>
  );
}
