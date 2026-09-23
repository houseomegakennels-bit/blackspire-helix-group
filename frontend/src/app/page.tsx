import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { HelixSculpture } from "@/components/helix-sculpture";
import { SculpturalEntrance } from "@/components/sculptural-entrance";
import { offers } from "@/components/public-offers";
import styles from "./sculptural-home.module.css";

export const metadata: Metadata = {
  title: "Blackspire Helix Group | We take the busy out of business.",
  description: "Business automation, websites, and custom apps built around your business. Spend less time on repetitive tasks and more time on what comes next.",
};
export default function Home() {
  return (
    <MarketingShell>
      <div className={styles.home}>
        <SculpturalEntrance>
          <section className={styles.hero} aria-labelledby="home-title">
            <div className={styles.heroCopy} data-entrance>
              <h1 id="home-title">We take the busy out of business.</h1>
              <p className={styles.lead}>Blackspire helps you respond to customers, follow up with leads, and handle everyday tasks automatically—so you can focus on running your business.</p>
              <div className={styles.actions}>
                <Link className="public-button" href="/contact">Let’s talk about your business</Link>
                <Link className={styles.textLink} href="#see-it-work">See it in action <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 19 19 5M5 5h14v14" /></svg></Link>
              </div>
            </div>
            <div className={styles.sculpture}><HelixSculpture /></div>
            <div className={styles.heroFoot}>
              <p>Your business. Your tools.<br/>A simpler way to work.</p>
              <p>Business automation<br/>Websites & custom apps</p>
            </div>
          </section>
        </SculpturalEntrance>
        <section className={styles.services} aria-labelledby="services-title">
          <div className={styles.sectionIntro}>
            <h2 id="services-title">You didn’t start a business to babysit one.</h2>
            <p>The missed inquiry. The same information entered twice. The follow-up you meant to send. Let’s take those jobs off your list.</p>
          </div>
          <div className={styles.offerList}>
            {offers.map((offer, index) => (
              <details key={offer.title} className={styles.offer} open={index === 0}>
                <summary><h3>{offer.title}</h3><span className={styles.plus} aria-hidden="true" /></summary>
                <div className={styles.offerBody}><p>{offer.text}</p><p className={styles.examples}>{offer.examples}</p><Link href="/services">Explore our services</Link></div>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.demo} id="see-it-work" aria-labelledby="demo-title">
          <div className={styles.demoCopy}>
            <h2 id="demo-title">From inquiry to the next step.</h2>
            <p>See how customer inquiries and follow-up come together in Helix Lawn Command.</p>
            <Link className={styles.textLink} href="/demos">Explore more demos <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 19 19 5M5 5h14v14" /></svg></Link>
            <p className={styles.disclaimer}>Illustrative workflow, not a measured client result.</p>
          </div>
          <div className={styles.videoFrame}>
            <video controls playsInline preload="metadata" poster="/demos/helix-lawn-command-poster.jpg" aria-label="Helix Lawn Command demonstration" src="/demos/helix-lawn-command-demo.mp4" />
            <div className={styles.videoCaption}><span>Helix Lawn Command</span><span>Product demonstration</span></div>
          </div>
        </section>
        <section className={styles.process} aria-labelledby="process-title">
          <h2 id="process-title">One conversation.<br/>A clearer plan.</h2>
          <ol>
            <li><strong>Tell us what takes too much time.</strong><p>No technical brief needed. Walk us through your day.</p></li>
            <li><strong>We recommend a practical fix.</strong><p>Start with the task that matters most, with a clear scope and quote.</p></li>
            <li><strong>We build it around your business.</strong><p>Agree on the work, test the workflow, and learn how to use it.</p></li>
          </ol>
        </section>
        <section className={styles.close}>
          <h2>What would you love to stop doing manually?</h2>
          <Link className="public-button" href="/contact">Tell us about it</Link>
          <p><Link href="/ecosystem">Looking for a specific Blackspire product? Explore the directory.</Link></p>
        </section>
      </div>
    </MarketingShell>
  );
}
