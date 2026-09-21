import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
export const metadata: Metadata = {
  title: "See It in Action | Blackspire Helix Group",
  description:
    "Explore Blackspire demonstrations for service-business inquiries and real estate buyer research.",
};
const demos = [
  {
    title: "Keep customer inquiries moving.",
    category: "Service businesses · Helix Lawn Command",
    src: "/demos/helix-lawn-command-demo.mp4",
    problem: "You’re busy with a job when another customer reaches out.",
    workflow:
      "Explore an example of inquiry capture and follow-up for a lawn-care business.",
    benefit:
      "A clearer next step for the customer and less chasing for the owner.",
  },
  {
    title: "Make buyer research easier to use.",
    category: "Real estate · Buyer Engine",
    src: "/demos/buyer-engine-demo-final.mp4",
    problem:
      "Buyer information is scattered, and preparing outreach takes time.",
    workflow:
      "See how buyer research, organized profiles, and outreach preparation fit together.",
    benefit:
      "Spend less time sorting information and more time reviewing relevant opportunities.",
  },
];
export default function DemosPage() {
  return (
    <MarketingShell>
      <div className="public-wrap">
        <section className="public-section">
          <p className="public-eyebrow">See it in action</p>
          <h1>
            Picture a simpler
            <br />
            <em>working day.</em>
          </h1>
          <p className="public-lead">
            Explore examples of what Blackspire can build around your business.
          </p>
          <p>
            These videos are demonstrations, not measured client results or
            guarantees. Your workflow and scope will be agreed before a project
            begins.
          </p>
        </section>
        {demos.map((d) => (
          <section className="public-section public-demo-row" key={d.src}>
            <div>
              <p className="public-eyebrow">{d.category}</p>
              <h2>{d.title}</h2>
              <video
                controls
                playsInline
                preload="metadata"
                aria-label={d.title}
                src={d.src}
              />
            </div>
            <div className="public-card">
              <h3>The everyday problem</h3>
              <p>{d.problem}</p>
              <h3>The example</h3>
              <p>{d.workflow}</p>
              <h3>What it helps with</h3>
              <p>{d.benefit}</p>
              <Link href="/contact" className="public-button">
                Could this help my business?
              </Link>
            </div>
          </section>
        ))}
        <section className="public-section public-close">
          <h2>Your business has its own way of working.</h2>
          <p>Let’s talk about a solution that fits yours.</p>
          <Link href="/contact" className="public-button">
            Start the conversation
          </Link>
          <p>
            <Link href="/ecosystem">Explore all Blackspire products</Link>
          </p>
        </section>
      </div>
    </MarketingShell>
  );
}
