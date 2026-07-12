"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import type { EcosystemProject } from "@/lib/ecosystem";

gsap.registerPlugin(ScrollTrigger);

const nodePositions = [
  "atlas-node-a",
  "atlas-node-b",
  "atlas-node-c",
  "atlas-node-d",
  "atlas-node-e",
  "atlas-node-f",
] as const;

export function HelixCommandAtlas({ projects }: { projects: EcosystemProject[] }) {
  const rootRef = useRef<HTMLElement>(null);
  const [activeSlug, setActiveSlug] = useState(projects[0]?.slug ?? "");
  const activeProject = projects.find((project) => project.slug === activeSlug) ?? projects[0];

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        ".atlas-core",
        { rotate: -12, scale: 0.84, opacity: 0.35 },
        {
          rotate: 12,
          scale: 1,
          opacity: 1,
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top bottom",
            end: "bottom top",
            scrub: 1.2,
          },
        },
      );

      gsap.fromTo(
        ".atlas-node",
        { y: 28, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          stagger: 0.08,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: root, start: "top 72%", once: true },
        },
      );
    }, root);

    return () => context.revert();
  }, [projects.length]);

  return (
    <section ref={rootRef} className="atlas-section" aria-labelledby="atlas-title">
      <div className="atlas-copy">
        <div className="atlas-kicker">The Blackspire operating map</div>
        <h2 id="atlas-title" className="atlas-title">
          One intelligence layer. <em>Many</em> precise outcomes.
        </h2>
        <p className="atlas-intro">
          Blackspire turns complex business motion into visible systems: strategy at the center,
          specialized divisions at the edge, and a clear next action between them.
        </p>

        {activeProject ? (
          <div className="atlas-detail" key={activeProject.slug}>
            <div className="atlas-detail-index">{activeProject.monogram} / {activeProject.role}</div>
            <h3>{activeProject.name}</h3>
            <p>{activeProject.primaryOutcome}</p>
            <Link href={activeProject.href} className="atlas-detail-link">
              Enter system <span aria-hidden="true">↗</span>
            </Link>
          </div>
        ) : null}
      </div>

      <div className="atlas-visual" aria-label="Interactive Blackspire ecosystem map">
        <div className="atlas-visual-grid" aria-hidden="true" />
        <div className="atlas-core" aria-hidden="true">
          <div className="atlas-core-inner">BH</div>
          <span className="atlas-core-ring atlas-core-ring-one" />
          <span className="atlas-core-ring atlas-core-ring-two" />
          <span className="atlas-core-ring atlas-core-ring-three" />
        </div>
        <div className="atlas-axis atlas-axis-x" aria-hidden="true" />
        <div className="atlas-axis atlas-axis-y" aria-hidden="true" />

        {projects.slice(0, 6).map((project, index) => (
          <button
            key={project.slug}
            type="button"
            className={`atlas-node ${nodePositions[index] ?? "atlas-node-a"}${project.slug === activeSlug ? " is-active" : ""}`}
            style={{ "--node-accent": project.accent } as CSSProperties}
            onClick={() => setActiveSlug(project.slug)}
            aria-pressed={project.slug === activeSlug}
          >
            <span className="atlas-node-mark">{project.monogram}</span>
            <span className="atlas-node-copy">
              <strong>{project.name.replace("Blackspire ", "")}</strong>
              <small>{project.iconCue}</small>
            </span>
          </button>
        ))}

        <div className="atlas-signal atlas-signal-one">SYSTEMS ONLINE <span>09</span></div>
        <div className="atlas-signal atlas-signal-two">SYNC / 24.7ms</div>
      </div>
    </section>
  );
}
