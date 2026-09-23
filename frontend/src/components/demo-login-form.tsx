"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DemoLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    const payload = await response.json();
    if (!response.ok) { setBusy(false); return setError(payload.error ?? "Sign-in failed."); }
    const roleResponse = await fetch("/api/auth/role", { cache: "no-store" });
    const rolePayload = await roleResponse.json();
    if (rolePayload.role !== "demo_viewer" && rolePayload.role !== "demo_operator" && rolePayload.role !== "admin") { setBusy(false); return setError("This login does not have demo access."); }
    router.push("/demo");
    router.refresh();
  }

  return <form onSubmit={submit} className="mx-auto mt-10 max-w-md space-y-5 rounded-3xl border border-amber-300/20 bg-black/70 p-7 shadow-2xl"><label className="block text-sm text-zinc-300">Email<input required type="email" name="email" autoComplete="email" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/60" /></label><label className="block text-sm text-zinc-300">Password<input required type="password" name="password" autoComplete="current-password" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/60" /></label><button disabled={busy} className="w-full rounded-xl bg-amber-300 px-5 py-3 font-bold text-black">{busy ? "Opening workspace…" : "Open demonstration"}</button>{error ? <p className="text-sm text-red-300">{error}</p> : null}</form>;
}
