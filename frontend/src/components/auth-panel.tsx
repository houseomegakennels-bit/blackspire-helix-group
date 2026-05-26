"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BuyerShell, Panel, StatusPill } from "@/components/buyer-shell";

type AuthStatusPayload = {
  ok: boolean;
  authConfigured?: boolean;
  bootstrapRequired?: boolean;
  operator?: {
    id: string;
    email: string | null;
  } | null;
  error?: string;
};

export function AuthPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatusPayload | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  async function refreshStatus() {
    setLoadingStatus(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const payload = (await response.json()) as AuthStatusPayload;
      setStatus(payload);
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Auth status could not be loaded.");
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Auth status could not be loaded.");
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function submit(path: "/api/auth/bootstrap" | "/api/auth/sign-in") {
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as AuthStatusPayload;
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Operator auth request failed.");
        return;
      }

      setMessage(path === "/api/auth/bootstrap" ? "Operator account created and signed in." : "Signed in.");
      await refreshStatus();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Operator auth request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) {
        throw new Error("Sign-out failed.");
      }
      setMessage("Signed out.");
      await refreshStatus();
      router.refresh();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Sign-out failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirmation do not match.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });

      const payload = (await response.json()) as AuthStatusPayload & { message?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Password change failed.");
        return;
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setMessage(payload.message ?? "Password changed.");
      await refreshStatus();
      router.refresh();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Password change failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const bootstrapRequired = status?.bootstrapRequired ?? false;
  const signedIn = Boolean(status?.operator);

  return (
      <BuyerShell
        eyebrow="Operator Access"
        title="Auth Control"
        description="This is the handoff away from the shared default operator id. Bootstrap the first operator once, then use sign-in for normal sessions."
        operatorStatus={
          status
            ? {
                authConfigured: Boolean(status.authConfigured),
                signedIn: Boolean(status.operator),
                bootstrapRequired: Boolean(status.bootstrapRequired),
                usingFallback: !status.operator && Boolean(status.bootstrapRequired),
                requiresAuth: !status.operator && !status.bootstrapRequired,
                operatorId: status.operator?.id ?? null,
                operatorEmail: status.operator?.email ?? null,
              }
            : null
        }
      >
      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Panel
          eyebrow="Status"
          title="Current operator session"
          description="The app will prefer the signed-in Supabase auth user for jobs, exports, and drafts. It only falls back to the default bridge when no session exists."
        >
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={status?.authConfigured ? "good" : "bad"} label={status?.authConfigured ? "auth env ready" : "auth env missing"} />
            <StatusPill tone={signedIn ? "good" : "warn"} label={signedIn ? "signed in" : "no active session"} />
            <StatusPill tone={bootstrapRequired ? "warn" : "good"} label={bootstrapRequired ? "bootstrap required" : "bootstrap complete"} />
          </div>

          <div className="brand-copy-soft mt-5 space-y-3 text-sm leading-6">
            {loadingStatus ? <p>Loading auth status...</p> : null}
            {status?.operator ? (
              <div className="brand-card p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Signed-in operator</div>
                <div className="mt-2 text-white">{status.operator.email ?? "No email exposed"}</div>
                <div className="mt-1 font-mono text-xs text-[var(--copy-muted)]">{status.operator.id}</div>
              </div>
            ) : (
              <div className="brand-card p-4 text-[var(--copy-soft)]">
                No operator session is active yet. Jobs and drafts will keep using the default bridge until you sign in.
              </div>
            )}
            {message ? <p className="text-[var(--gold-soft)]">{message}</p> : null}
            {error ? <p className="text-[hsl(22_100%_72%)]">{error}</p> : null}
            {signedIn ? (
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={submitting}
                className="brand-button px-4 py-2 text-sm disabled:opacity-60"
              >
                {submitting ? "Working..." : "Sign out"}
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel
          eyebrow="Access Flow"
          title={bootstrapRequired ? "Create the first operator" : "Sign in as operator"}
          description={
            bootstrapRequired
              ? "There are currently no Supabase auth users in this project. The first operator is created here and immediately signed in."
              : "Use a real operator account instead of the shared default bridge."
          }
        >
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(bootstrapRequired ? "/api/auth/bootstrap" : "/api/auth/sign-in");
            }}
          >
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                className="brand-input w-full px-3 py-2 text-sm outline-none"
                placeholder="operator@blackspire.com"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                className="brand-input w-full px-3 py-2 text-sm outline-none"
                placeholder={bootstrapRequired ? "Create a strong password" : "Operator password"}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={submitting || !form.email || !form.password}
                className="border border-[hsl(38_92%_55%/.45)] bg-[hsl(38_92%_55%/.12)] px-4 py-2 text-sm font-medium text-[hsl(38_92%_55%)] disabled:opacity-60"
              >
                {submitting
                  ? "Working..."
                  : bootstrapRequired
                    ? "Create operator and sign in"
                    : "Sign in"}
              </button>
              <button
                type="button"
                onClick={() => void refreshStatus()}
                disabled={submitting}
                className="brand-button px-4 py-2 text-sm disabled:opacity-60"
              >
                Refresh auth status
              </button>
            </div>
          </form>
        </Panel>

        {signedIn ? (
          <Panel
            eyebrow="Security"
            title="Change password"
            description="Update the signed-in operator password without leaving the app."
          >
            <form className="grid gap-5" onSubmit={(event) => void changePassword(event)}>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Current password</span>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                  className="brand-input w-full px-3 py-2 text-sm outline-none"
                  placeholder="Current operator password"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">New password</span>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                  className="brand-input w-full px-3 py-2 text-sm outline-none"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[var(--copy-muted)]">Confirm new password</span>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                  className="brand-input w-full px-3 py-2 text-sm outline-none"
                  placeholder="Repeat the new password"
                />
              </label>
              <button
                type="submit"
                disabled={
                  submitting ||
                  !passwordForm.currentPassword ||
                  !passwordForm.newPassword ||
                  !passwordForm.confirmPassword
                }
                className="brand-button px-4 py-2 text-sm disabled:opacity-60"
              >
                {submitting ? "Working..." : "Change password"}
              </button>
            </form>
          </Panel>
        ) : null}
      </div>
    </BuyerShell>
  );
}
