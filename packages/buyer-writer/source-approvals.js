import registry from './approved-source-registry.json' with { type: 'json' };
import { BuyerSourceError } from './source-http.js';

const frontendMarkers={wake:'arcgis_wake',lincoln:'arcgis',forsyth:'arcgis_forsyth',mecklenburg:'arcgis_mecklenburg',
  brunswick:'arcgis',orange:'arcgis',beaufort:'arcgis_beaufort',ashe:'arcgis_ashe',avery:'arcgis_avery',burke:'arcgis_burke',
  wilkes:'arcgis_wilkes',haywood:'arcgis_haywood',sampson:'arcgis',davie:'arcgis',catawba:'arcgis',edgecombe:'arcgis',
  nash:'arcgis_nash',granville:'arcgis_granville',duplin:'arcgis_duplin'};
const ncOneMap=new Set(['chowan','currituck','jackson','pamlico','randolph','rockingham','johnston','columbus','dare']);

// Static release approval, never generated from the live request's registry
// rows. Changes to active inventory, URL bytes, type, cash flags or ordering
// require a reviewed manifest change. No source URL values or credentials here.
export function approvedBuyerSources(job) {
  if(typeof job?.property_type!=='string')throw new BuyerSourceError('SOURCE_POLICY_REJECTED');
  const land=job.property_type.trim().toLowerCase()==='land';
  return registry.sources.map(s=>{
    const county=s.county.toLowerCase();
    const frontend=Object.hasOwn(frontendMarkers,county)&&(!['wake','lincoln'].includes(county)||land);
    let pathTransform='strip_query';
    if(frontend&&county==='mecklenburg')pathTransform='append_query';
    if(!frontend) {
      if(county==='stanly')pathTransform='stanly_fixed';
      else if(!['arcgis_guilford','arcgis_wake'].includes(s.registeredSourceType)&&county!=='stokes'&&county!=='lincoln'&&!ncOneMap.has(county))pathTransform='preserve_query';
    }
    return {...s,adapterId:frontend?`${county}-v1`:`legacy-${county.replaceAll(' ','_')}-v1`,
      sourceType:frontend?frontendMarkers[county]:s.registeredSourceType,
      method:frontend&&['wake','lincoln','nash','mecklenburg'].includes(county)?'POST':'GET',pathTransform,
      timeoutMs:county==='mecklenburg'?30000:20000};
  });
}
