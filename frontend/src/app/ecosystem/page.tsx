import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { ecosystemProjects, type EcosystemProject } from "@/lib/ecosystem";

export const metadata: Metadata = {
  title: "Products | Blackspire Helix Group",
  description: "Explore Blackspire products for your business and see what is in development.",
};

function ProductCard({ project }: { project: EcosystemProject }) {
  return (
    <article className="public-card public-product-card">
      {project.logoSrc ? (
        <div className="public-product-logo">
          <Image src={project.logoSrc} alt="" width={240} height={160} />
        </div>
      ) : null}
      <div>
        <p className="public-product-role">{project.role}</p>
        <h3>{project.name}</h3>
        <p>{project.description}</p>
      </div>
      <div className="public-product-audience">
        <span>For</span>
        <p>{project.targetUser}</p>
      </div>
      <div className="public-product-actions">
        <Link className="public-button-secondary" href={project.href}>
          Explore product<span className="sr-only">: {project.name}</span>
        </Link>
        {project.productHref ? (
          <Link href={project.productHref}>
            Open workspace<span className="sr-only">: {project.name}</span>
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export default function EcosystemPage() {
  return (
    <MarketingShell>
      <div className="public-wrap public-products">
        <section className="public-directory-intro">
          <h1>Find the right tool for your business.</h1>
          <p className="public-lead">Explore Blackspire products, learn what each one does, or open your existing workspace.</p>
          <nav className="public-directory-links" aria-label="Product sections">
            <a href="#available">Available products</a>
            <a href="#development">In development</a>
            <Link href="/workspaces">Client access</Link>
          </nav>
        </section>
        <section id="available" className="public-section public-product-section">
          <h2>Available products</h2>
          <div className="public-grid">
            {ecosystemProjects.filter((project) => project.status === "live").map((project) => (
              <ProductCard key={project.slug} project={project} />
            ))}
          </div>
        </section>
        <section id="development" className="public-section public-product-section">
          <h2>In development</h2>
          <p className="public-intro">Explore the concepts taking shape. Contact us to discuss availability.</p>
          <div className="public-grid">
            {ecosystemProjects.filter((project) => project.status === "building").map((project) => (
              <ProductCard key={project.slug} project={project} />
            ))}
          </div>
        </section>
        <section className="public-section public-close">
          <h2>Not sure which product fits?</h2>
          <p>Tell us what you want to simplify. We’ll help you find a useful starting point.</p>
          <Link href="/contact" className="public-button">Let’s talk</Link>
        </section>
      </div>
    </MarketingShell>
  );
}
