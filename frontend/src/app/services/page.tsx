import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { PublicOffers } from "@/components/public-offers";
export const metadata: Metadata = {
  title: "Business Automation & Websites | Blackspire Helix Group",
  description:
    "Customer follow-up, everyday task automation, websites, and custom apps for business owners.",
};
export default function ServicesPage() {
  return (
    <MarketingShell>
      <div className="public-wrap">
        <section className="public-section">
          <p className="public-eyebrow">What we do</p>
          <h1>
            Less chasing.
            <br />
            <em>More doing.</em>
          </h1>
          <p className="public-lead">
            You know your business. We help make the everyday work easier—with
            practical tools built around how you operate.
          </p>
          <div className="public-actions">
            <Link className="public-button" href="/contact">
              Let’s talk about your business
            </Link>
            <Link className="public-button-secondary" href="/demos">
              See examples
            </Link>
          </div>
        </section>
        <PublicOffers />
        <section className="public-section public-process">
          <div>
            <p className="public-eyebrow">Start where you are</p>
            <h2>
              A useful first step,
              <br />
              whatever your setup.
            </h2>
          </div>
          <ol>
            <li>
              <strong>Not sure what you need?</strong>
              <p>
                Tell us where your time goes. We’ll identify a task worth
                simplifying.
              </p>
            </li>
            <li>
              <strong>Have a project in mind?</strong>
              <p>
                We’ll discuss what it needs to do, the tools involved, and the
                scope before work begins.
              </p>
            </li>
            <li>
              <strong>Already using software?</strong>
              <p>
                We’ll look at what can be connected or improved so you can make
                better use of it.
              </p>
            </li>
          </ol>
        </section>
        <section className="public-section public-close">
          <h2>Start with one thing you want to run better.</h2>
          <p>
            We’ll discuss the approach and provide a project-specific quote. No
            technical knowledge required.
          </p>
          <Link className="public-button" href="/contact">
            Start the conversation
          </Link>
        </section>
      </div>
    </MarketingShell>
  );
}
