import Link from "next/link";

export default function DemoExpiredPage() {
  return <main className="grid min-h-screen place-items-center bg-black px-6 text-center text-white"><div><p className="text-xs uppercase tracking-[0.35em] text-amber-200">Blackspire temporary access</p><h1 className="mt-4 text-4xl font-black">This demonstration has ended.</h1><p className="mx-auto mt-4 max-w-xl text-zinc-400">Your data was never added to the system. Contact Carlos if you would like another guided look or want to discuss a version built around your operation.</p><Link href="/contact" className="mt-7 inline-block rounded-xl bg-amber-300 px-5 py-3 font-bold text-black">Contact Blackspire</Link></div></main>;
}
