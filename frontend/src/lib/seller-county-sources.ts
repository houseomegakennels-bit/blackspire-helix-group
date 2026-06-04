import type { SellerSourceType } from "@/lib/seller-engine";

export type SellerCountyStarterSource = {
  county: string;
  state: "NC";
  name: string;
  sourceType: SellerSourceType;
  sourceUrl: string;
  integrationType: "county_portal";
  notes: string;
};

export const SELLER_COUNTY_STARTER_SOURCES: SellerCountyStarterSource[] = [
  {
    county: "Mecklenburg",
    state: "NC",
    name: "Mecklenburg Open Mapping",
    sourceType: "gis_property_data",
    sourceUrl: "https://maps.mecklenburgcountync.gov/openmapping/",
    integrationType: "county_portal",
    notes: "Official Mecklenburg County open mapping and parcel access point.",
  },
  {
    county: "Mecklenburg",
    state: "NC",
    name: "Mecklenburg Tax Foreclosure Properties",
    sourceType: "foreclosure",
    sourceUrl: "https://tax.mecknc.gov/",
    integrationType: "county_portal",
    notes: "Official Mecklenburg tax office portal with delinquent property lists and tax foreclosure properties.",
  },
  {
    county: "Wake",
    state: "NC",
    name: "Wake County Open Data",
    sourceType: "gis_property_data",
    sourceUrl: "https://data.wake.gov/",
    integrationType: "county_portal",
    notes: "Official Wake County open data portal for parcel and property research inputs.",
  },
  {
    county: "Wake",
    state: "NC",
    name: "Wake CRPI Foreclosure Notices",
    sourceType: "foreclosure",
    sourceUrl: "https://rodcrpi.wake.gov/bookshelp2/crpifeatures.html",
    integrationType: "county_portal",
    notes: "Official Wake Register of Deeds CRPI help page documenting foreclosure notice access.",
  },
  {
    county: "Forsyth",
    state: "NC",
    name: "Forsyth CAD Parcels",
    sourceType: "gis_property_data",
    sourceUrl: "https://maps.co.forsyth.nc.us/arcgis/rest/services/CAD/CAD_Parcels/MapServer",
    integrationType: "county_portal",
    notes: "Official Forsyth parcel MapServer service.",
  },
  {
    county: "Forsyth",
    state: "NC",
    name: "Forsyth Property Tax Foreclosure Sales",
    sourceType: "foreclosure",
    sourceUrl: "https://www.co.forsyth.nc.us/Tax/foreclosure.aspx",
    integrationType: "county_portal",
    notes: "Official Forsyth tax foreclosure sales page.",
  },
  {
    county: "Guilford",
    state: "NC",
    name: "Guilford GIS Online Services",
    sourceType: "gis_property_data",
    sourceUrl: "https://www.guilfordcountync.gov/government/departments-and-agencies/information-technology/geographic-information-systems/gis-online-services",
    integrationType: "county_portal",
    notes: "Official Guilford GIS services index with parcel research and open data tools.",
  },
  {
    county: "Guilford",
    state: "NC",
    name: "Guilford Foreclosure Research Tool",
    sourceType: "foreclosure",
    sourceUrl: "https://www.guilfordcountync.gov/government/departments-and-agencies/information-technology/geographic-information-systems/gis-online-services",
    integrationType: "county_portal",
    notes: "Official Guilford GIS page linking the county foreclosure research tool.",
  },
  {
    county: "Cumberland",
    state: "NC",
    name: "Cumberland Real Estate GIS Mapping",
    sourceType: "gis_property_data",
    sourceUrl: "https://www.cumberlandcountync.gov/departments/tax-group/tax/real-estate-gis-mapping",
    integrationType: "county_portal",
    notes: "Official Cumberland real estate and GIS mapping access point.",
  },
  {
    county: "Cumberland",
    state: "NC",
    name: "Cumberland Tax Foreclosure Sales",
    sourceType: "foreclosure",
    sourceUrl: "https://www.cumberlandcountync.gov/departments/tax-group/tax/tax-foreclosure-sales",
    integrationType: "county_portal",
    notes: "Official Cumberland tax foreclosure sales list.",
  },
  {
    county: "Cumberland",
    state: "NC",
    name: "Cumberland Delinquent Taxes",
    sourceType: "tax_delinquent",
    sourceUrl: "https://www.cumberlandcountync.gov/CustomContent/tax/delinquent_taxes/delinquent_taxes.aspx?TaxDelinquent_GVChangePage=91_20",
    integrationType: "county_portal",
    notes: "Official Cumberland delinquent tax advertisement page.",
  },
];
