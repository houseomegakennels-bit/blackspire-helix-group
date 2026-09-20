import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing-shell";
import { PublicContactForm } from "@/components/public-contact-form";
import { publicContact } from "@/lib/public-contact";
export const metadata: Metadata = {
  title: "Let’s Talk | Blackspire Helix Group",
  description:
    "Talk with Blackspire about customer follow-up, repetitive tasks, websites, or a custom app for your business.",
};
export default function ContactPage() {
  return (
    <MarketingShell>
      <div className="public-wrap">
        <section className="public-section">
          <p className="public-eyebrow">Let’s talk about your business</p>
          <h1>
            Your business called.
            <br />
            <em>It wants its time back.</em>
          </h1>
          <p className="public-lead">
            Tell us what’s taking up your day. We’ll help you work out what can
            be made simpler.
          </p>
        </section>
        <div className="public-contact-grid">
          <section className="public-card" id="project-brief">
            <h2>What needs to run better?</h2>
            <PublicContactForm />
          </section>
          <aside className="public-card">
            <p className="public-eyebrow">Prefer to reach out directly?</p>
            <h2>Let’s start there.</h2>
            <div className="public-contact-links">
              <a href={publicContact.phoneHref}>Call {publicContact.phone}</a>
              <a href={publicContact.emailHref}>{publicContact.email}</a>
            </div>
            <h3>What happens next</h3>
            <p>
              We’ll review your message, talk through the problem, and recommend
              a practical starting point.
            </p>
            <p>
              If it’s a fit, we’ll agree on the scope and quote before any build
              work begins.
            </p>
            <p>
              You don’t need to know which software or service to ask for. Just
              tell us about the work.
            </p>
          </aside>
        </div>
      </div>
    </MarketingShell>
  );
}
