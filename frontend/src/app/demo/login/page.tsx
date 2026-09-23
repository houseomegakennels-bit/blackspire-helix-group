import Image from "next/image";
import { DemoLoginForm } from "@/components/demo-login-form";

export default function DemoLoginPage() {
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(214,168,79,.16),transparent_32%),#030303] px-5 py-16 text-white"><div className="mx-auto max-w-4xl text-center"><Image src="/brand/blackspire-helix-group-logo-fit.png" alt="Blackspire Helix Group" width={180} height={180} className="mx-auto h-28 w-28 object-contain" /><p className="mt-6 text-xs uppercase tracking-[0.4em] text-amber-200">Protected client demonstration</p><h1 className="mt-4 text-4xl font-black sm:text-5xl">Real estate operations, in motion.</h1><p className="mx-auto mt-4 max-w-2xl leading-7 text-zinc-400">Sign in with the email and password you selected from your private invitation. The demonstration uses live operational counts while protecting private contact information.</p><DemoLoginForm /></div></main>;
}
