import { getBetaProgramSnapshot } from "@/lib/beta-server";
import { requireAdminPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

function fmt(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

const CATEGORY_COLOR: Record<string, string> = {
  navigation: "#60a5fa",
  bug: "#f87171",
  bad_data: "#fbbf24",
  missing_feature: "#a78bfa",
  performance: "#fb923c",
  other: "#94a3b8",
};

export default async function AdminBetaPage() {
  await requireAdminPage();
  const snap = await getBetaProgramSnapshot();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.1),transparent_34%),linear-gradient(180deg,#020403,#06090b_44%,#020303)]">
      <div className="relative z-10 mx-auto max-w-[1200px] space-y-6 px-4 py-8 lg:px-6 lg:py-10">
        <div className="brand-panel p-6 lg:p-7">
          <div className="text-[10px] uppercase tracking-[0.4em] text-[#5eead4]">Admin · Beta Program</div>
          <h1 className="mt-2 text-3xl font-black tracking-[0.04em] text-white">Beta Testers & Feedback</h1>
          <p className="mt-2 text-sm text-[var(--copy-soft)]">Signups, activity, and feedback from the beta cohort.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Beta Testers", value: snap.totals.testers },
            { label: "Sweeps Run", value: snap.totals.sweeps },
            { label: "Exports", value: snap.totals.exports },
            { label: "Feedback Items", value: snap.totals.feedback },
          ].map((m) => (
            <div key={m.label} className="brand-panel p-5">
              <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--copy-muted)]">{m.label}</div>
              <div className="mt-2 text-3xl font-black text-white">{m.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="brand-panel p-6">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Testers</div>
            <div className="mt-4 space-y-2">
              {snap.testers.length ? (
                snap.testers.map((t) => (
                  <div key={t.id} className="rounded-[14px] border border-[var(--line)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-white">{t.email ?? "Unknown"}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--copy-muted)]">joined {fmt(t.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--copy-soft)]">Last sign-in: {fmt(t.lastSignInAt)}</div>
                    {t.useCase ? <div className="mt-1 text-xs text-[#5eead4]">Testing: {t.useCase}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-[var(--copy-soft)]">No beta testers have signed up yet.</div>
              )}
            </div>
          </div>

          <div className="brand-panel p-6">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-white">Feedback</div>
            <div className="mt-4 space-y-2">
              {snap.feedback.length ? (
                snap.feedback.map((f) => (
                  <div key={f.id} className="rounded-[14px] border border-[var(--line)] p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
                        style={{
                          color: CATEGORY_COLOR[f.category] ?? "#94a3b8",
                          background: `${CATEGORY_COLOR[f.category] ?? "#94a3b8"}1f`,
                        }}
                      >
                        {f.category.replaceAll("_", " ")}
                      </span>
                      <span className="truncate text-xs text-[var(--copy-muted)]">
                        {f.email ?? "anon"} · {fmt(f.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-white">{f.message}</div>
                    {f.pagePath ? <div className="mt-1 text-[10px] text-[var(--copy-muted)]">on {f.pagePath}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-[var(--copy-soft)]">No feedback yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
