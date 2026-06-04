import type { CSSProperties } from "react";

import { getProjectBySlug } from "@/lib/ecosystem";

/**
 * Maps an ecosystem division slug to its globals.css theme class. The class
 * remaps the --gold/--line token families (and --project-*) to the division's
 * logo palette, so every brand-* / project-* component inherits the right color.
 */
export const THEME_CLASS_BY_SLUG: Record<string, string> = {
  "recon-engine": "theme-recon-engine",
  "buyer-engine": "theme-buyer-engine",
  "deal-engine": "theme-deal-engine",
  "seller-engine": "theme-seller-engine",
  "helix-lawn-command": "theme-lawn-command",
  "social-os": "theme-social-os",
  "ember-halo": "theme-ember-halo",
  "oracle-helix": "theme-oracle-helix",
};

/**
 * Inline --project-* custom properties for a division, sourced from the
 * ecosystem registry (the single source of truth for logo-derived palettes).
 * Pair with the matching THEME_CLASS_BY_SLUG class on the same element.
 */
export function divisionThemeStyle(slug: string): CSSProperties {
  const project = getProjectBySlug(slug);
  if (!project) return {} as CSSProperties;
  return {
    "--project-accent": project.accent,
    "--project-glow": project.glow,
    "--project-surface": project.surfaceTint,
    "--project-edge": project.edgeTint,
  } as CSSProperties;
}

export function divisionThemeClass(slug: string): string {
  return THEME_CLASS_BY_SLUG[slug] ?? "";
}
