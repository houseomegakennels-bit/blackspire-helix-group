import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { PublicOffers } from "@/components/public-offers";
export const metadata: Metadata = {
  title: "Blackspire Helix Group | We take the busy out of business.",
  description:
    "Business automation, websites, and custom apps that help you follow up with customers and spend less time on repetitive tasks.",
};
export default function Home() {
  return (
    <MarketingShell>
      <div className="public-wrap">
        <section className="public-hero">
          <div>
            <p className="public-eyebrow">Built for business owners</p>
            <h1>
              We take the <em>busy</em> out of business.
            </h1>
            <p className="public-lead">
              Blackspire helps you respond to customers, follow up with leads,
              and handle everyday tasks automatically—so you can focus on
              running your business.
            </p>
            <div className="public-actions">
              <Link className="public-button" href="/contact">
                Let’s talk about your business
              </Link>
              <Link className="public-button-secondary" href="#see-it-work">
                See it in action
              </Link>
            </div>
            <p className="public-detail">
              Your business. Your tools. A simpler way to work.
            </p>
          </div>
          <div className="public-demo" id="see-it-work">
            <p className="public-eyebrow">See an example · Lawn care</p>
            <h2>From inquiry to the next step.</h2>
            <video
              controls
              playsInline
              preload="metadata"
              aria-label="Helix Lawn Command demonstration"
              src="/demos/helix-lawn-command-demo.mp4"
            />
            <p>
              A demonstration of how customer inquiries and follow-up can come
              together. Illustrative workflow, not a measured client result.
            </p>
            <Link href="/demos">Explore more demos →</Link>
          </div>
        </section>
        <section className="public-section">
          <p className="public-eyebrow">Sound familiar?</p>
          <h2>You didn’t start a business to babysit one.</h2>
          <p className="public-intro">
            The missed inquiry. The same information entered twice. The
            follow-up you meant to send. Let’s take those jobs off your list.
          </p>
          <PublicOffers />
        </section>
        <section className="public-section public-process">
          <div>
            <p className="public-eyebrow">A straightforward start</p>
            <h2>
              One conversation.
              <br />A clearer plan.
            </h2>
          </div>
          <ol>
            <li>
              <strong>Tell us what takes too much time.</strong>
              <p>No technical brief needed. Walk us through your day.</p>
            </li>
            <li>
              <strong>We recommend a practical fix.</strong>
              <p>
                Start with the task that matters most, with a clear scope and
                quote.
              </p>
            </li>
            <li>
              <strong>We build it around your business.</strong>
              <p>
                Agree on the work, test the workflow, and learn how to use it.
              </p>
            </li>
          </ol>
        </section>
        <section className="public-section public-close">
          <p className="public-eyebrow">Let’s find your time back</p>
          <h2>What would you love to stop doing manually?</h2>
          <Link href="/contact" className="public-button">
            Tell us about it
          </Link>
          <p>
            <Link href="/ecosystem">
              Looking for a specific Blackspire product? Explore the directory.
            </Link>
          </p>
        </section>
      </div>
    </MarketingShell>
  );
}
