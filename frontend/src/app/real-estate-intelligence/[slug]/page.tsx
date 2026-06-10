import { notFound, redirect } from "next/navigation";

import { getRealEstateEngineBySlug } from "@/lib/real-estate-intelligence";

export async function generateStaticParams() {
  return ["harvester", "seller-engine", "nexus", "deal-engine", "buyer-engine"].map((slug) => ({ slug }));
}

export default async function RealEstateEngineAliasPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const engine = getRealEstateEngineBySlug(slug);
  if (!engine) notFound();

  if (slug === "harvester") redirect("/ecosystem/harvester");
  if (slug === "seller-engine") redirect("/ecosystem/seller-engine");
  if (slug === "deal-engine") redirect("/ecosystem/deal-engine");
  if (slug === "buyer-engine") redirect("/ecosystem/buyer-engine");
  if (slug === "nexus") redirect("/ecosystem/nexus");
}
