export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <section className="relative flex min-h-screen items-center justify-center px-6 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#3b2a11_0%,transparent_35%),radial-gradient(circle_at_bottom_right,#111827_0%,transparent_30%)]" />

        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:72px_72px]" />

        <div className="relative z-10 mx-auto max-w-6xl text-center">
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.45em] text-amber-300">
            BLACKSPIRE HELIX GROUP
          </p>

          <h1 className="mx-auto max-w-5xl text-5xl font-black tracking-tight text-white md:text-7xl lg:text-8xl">
            AI systems for businesses ready to stop moving like it is 1999.
          </h1>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-300 md:text-xl">
            We build agent-powered websites, automation workflows, sales
            systems, and digital infrastructure that make ordinary businesses
            look dangerous online.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              className="rounded-full bg-amber-300 px-8 py-4 text-sm font-bold uppercase tracking-[0.2em] text-black shadow-[0_0_40px_rgba(252,211,77,.25)] transition hover:scale-105"
              href="#systems"
            >
              Enter the system
            </a>

            <a
              className="rounded-full border border-white/15 px-8 py-4 text-sm font-bold uppercase tracking-[0.2em] text-white/80 backdrop-blur transition hover:border-amber-300/70 hover:text-amber-200"
              href="#contact"
            >
              Build with us
            </a>
          </div>
        </div>
      </section>

      <section
        id="systems"
        className="relative border-t border-white/10 bg-black px-6 py-24"
      >
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            [
              "Blackspire Social OS",
              "AI-assisted content, posting strategy, brand voice, and social presence built to make attention compound.",
            ],
            [
              "Blackspire Buyer Engine",
              "Lead capture, follow-up, offer positioning, and conversion workflows for businesses that need customers now.",
            ],
            [
              "Helix Command Layer",
              "Internal automations, dashboards, prompts, agents, and operating systems that turn chaos into leverage.",
            ],
          ].map(([title, body]) => (
            <div
              key={title}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur"
            >
              <div className="mb-6 h-12 w-12 rounded-2xl border border-amber-300/30 bg-amber-300/10 shadow-[0_0_35px_rgba(252,211,77,.15)]" />

              <h2 className="text-2xl font-bold text-white">{title}</h2>

              <p className="mt-4 leading-7 text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="contact"
        className="border-t border-white/10 bg-[#070707] px-6 py-24 text-center"
      >
        <p className="text-sm font-semibold uppercase tracking-[0.4em] text-amber-300">
          The future does not wait.
        </p>

        <h2 className="mx-auto mt-6 max-w-4xl text-4xl font-black md:text-6xl">
          Bring the machine to your business before your competitors do.
        </h2>

        <p className="mx-auto mt-6 max-w-2xl text-zinc-400">
          BLACKSPIRE HELIX GROUP builds the systems, agents, and digital weapons
          that make your operation feel bigger than the room.
        </p>
      </section>
    </main>
  );
}