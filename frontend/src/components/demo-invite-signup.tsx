"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoInviteSignup({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password !== confirmation) return setError("The passwords do not match.");
    setBusy(true);
    const response = await fetch("/api/demo/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, fullName: form.get("fullName"), email: form.get("email"), password }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) return setError(payload.error ?? "Your invitation could not be accepted.");
    router.push(payload.signedIn ? "/demo" : "/demo/login");
    router.refresh();
  }

  return <form onSubmit={submit} className="mx-auto mt-10 max-w-md space-y-5 rounded-3xl border border-amber-300/20 bg-black/70 p-7 text-left shadow-2xl"><label className="block text-sm text-zinc-300">Name<input required name="fullName" autoComplete="name" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/60" /></label><label className="block text-sm text-zinc-300">Email<input required type="email" name="email" autoComplete="email" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/60" /></label><label className="block text-sm text-zinc-300">Choose a password<input required minLength={10} type="password" name="password" autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/60" /><span className="mt-2 block text-xs text-zinc-500">Use at least 10 characters.</span></label><label className="block text-sm text-zinc-300">Confirm password<input required minLength={10} type="password" name="confirmation" autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-amber-300/60" /></label><button disabled={busy} className="w-full rounded-xl bg-amber-300 px-5 py-3 font-bold text-black">{busy ? "Creating access…" : "Create my demonstration access"}</button>{error ? <p className="text-sm leading-6 text-red-300">{error}</p> : null}<p className="text-center text-xs leading-5 text-zinc-500">Already registered? <Link href="/demo/login" className="text-amber-200 underline">Sign in here</Link>.</p></form>;
}
