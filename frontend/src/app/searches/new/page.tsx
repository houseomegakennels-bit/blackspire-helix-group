import { NewSearchForm } from "@/components/new-search-form";
import { fallbackCountyCapabilities } from "@/lib/buyer-engine-data";
import { getLiveCountyCapabilities } from "@/lib/buyer-engine-server";

export default async function NewSearchPage() {
  const counties = await getLiveCountyCapabilities(true);
  const countyLoadError =
    counties === fallbackCountyCapabilities
      ? "County source feed is unavailable. Showing embedded fallback list."
      : null;

  return <NewSearchForm initialCountyOptions={counties} countyLoadError={countyLoadError} />;
}
