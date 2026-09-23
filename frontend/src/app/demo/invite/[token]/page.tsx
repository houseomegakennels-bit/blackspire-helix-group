import Image from "next/image";

import { DemoInviteSignup } from "@/components/demo-invite-signup";

export const dynamic = "force-dynamic";

export default async function DemoInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(214,168,79,.16),transparent_32%),#030303] px-5 py-14 text-white"><div className="mx-auto max-w-4xl text-center"><Image src="/brand/blackspire-helix-group-logo-fit.png" alt="Blackspire Helix Group" width={180} height={180} className="mx-auto h-28 w-28 object-contain" /><p className="mt-6 text-xs uppercase tracking-[0.4em] text-amber-200">Private invitation</p><h1 className="mt-4 text-4xl font-black sm:text-5xl">Choose your sign-in details</h1><p className="mx-auto mt-4 max-w-2xl leading-7 text-zinc-400">Enter the email and password you want to use. This invitation works once and creates time-limited access to the protected Blackspire real estate demonstration.</p><DemoInviteSignup token={token} /></div></main>;
}
