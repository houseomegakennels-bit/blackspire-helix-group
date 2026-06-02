import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { HelixLogo } from "@/components/oracle/HelixLogo";
import { Panel, Pill, SectionTitle } from "@/components/oracle/Primitives";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing · Oracle Helix" },
      { name: "description", content: "Oracle Helix pricing — Free, Pro $29/mo, Elite $79/mo, Sharp $149/mo." },
    ],
  }),
  component: PricingPage,
});

const TIERS = [
  { name: "Free", price: 0, tag: "Explore", features: ["Daily AI briefing", "3 sports coverage", "Limited charts", "Top 5 Helix scores"] },
  { name: "Pro", price: 29, tag: "Most popular", features: ["All 6 sports", "Helix scoring engine", "Sharp money feed", "Player Lab", "Standard alerts"], featured: true },
  { name: "Elite", price: 79, tag: "Power users", features: ["Everything in Pro", "War Room layouts", "Simulation Lab", "All 10 AI modes", "BetDNA tracker"] },
  { name: "Sharp", price: 149, tag: "Pro syndicates", features: ["Everything in Elite", "Multi-monitor war room", "API access", "Priority sharp alerts", "Custom AI prompts", "Admin team seats"] },
];

function PricingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 backdrop-blur">
        <div className="max-w-7xl mx-auto h-16 px-4 md:px-8 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <HelixLogo size={30} />
            <span className="font-semibold tracking-wider text-sm uppercase">Oracle <span className="text-gradient-helix">Helix</span></span>
          </Link>
          <Link to="/dashboard" className="text-sm px-4 py-2 rounded-lg bg-gradient-helix text-background font-medium">Launch Terminal</Link>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-16">
        <SectionTitle eyebrow="Pricing" title="Intelligence at your tempo." description="Start free. Upgrade when you're ready to see every signal on the board." />

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
          {TIERS.map((t) => (
            <Panel key={t.name} className={t.featured ? "border-primary/60 glow-neon" : ""}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">{t.name}</h3>
                <Pill tone={t.featured ? "helix" : "muted"}>{t.tag}</Pill>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-mono-display text-5xl">${t.price}</span>
                <span className="text-muted-foreground text-sm">/mo</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-muted-foreground">
                    <Check className="size-4 text-primary mt-0.5 shrink-0" /> <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/login" className={"mt-7 block text-center text-sm py-2.5 rounded-lg transition " + (t.featured ? "bg-gradient-helix text-background font-medium" : "border border-border hover:border-primary/60")}>
                Choose {t.name}
              </Link>
            </Panel>
          ))}
        </div>

        <Panel className="mt-10 !p-8 text-center">
          <h3 className="font-semibold text-xl">Enterprise & syndicate plans</h3>
          <p className="text-muted-foreground mt-2 max-w-xl mx-auto text-sm">Multi-seat licenses, white-label dashboards, custom AI prompts, and dedicated data feeds.</p>
          <a href="mailto:sales@oraclehelix.ai" className="mt-5 inline-block text-primary text-sm hover:underline">Contact sales →</a>
        </Panel>
      </main>
    </div>
  );
}
