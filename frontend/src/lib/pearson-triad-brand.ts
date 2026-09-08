export const pearsonTriadBrand = {
  businessName: "Pearson Janitorial",
  divisionName: "Triad Branch",
  shortName: "Pearson Triad",
  tagline: "Cleaner spaces. Stronger business.",
  market: "North Carolina Triad",
  primaryCities: ["Winston-Salem", "Greensboro", "High Point"],
  contactCta: "Request a walkthrough",
  colors: {
    primary: "#0b2942",
    accent: "#2f80ed",
    success: "#56b83f",
    surface: "#f6fbff",
  },
} as const;

export type PearsonTriadBrand = typeof pearsonTriadBrand;
