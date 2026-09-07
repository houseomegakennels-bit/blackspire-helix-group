import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { BuyerSourceError } from './source-http.js';

const reject=()=>{throw new BuyerSourceError('SOURCE_POLICY_REJECTED');};
const hash=s=>createHash('sha256').update(s).digest('hex');
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const normalize=s=>typeof s==='string'?s.trim().toLowerCase():'';
const timestamp=value=>{
  if(typeof value!=='string')reject();
  const match=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(value);
  if(!match)reject();
  const base=`${match[1]}T${match[2]}`;
  const date=new Date(`${base}Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==base)reject();
  return`${base}.${(match[3]??'').padEnd(6,'0')}Z`;
};
export const FORSYTH_PARCEL_POLICY=Object.freeze({id:'forsyth-parcel-v1',
  url:'https://lrcpwa.ncptscloud.com/api/GetParcelDetailsByQueryParam',method:'POST',encoding:'json',
  headers:Object.freeze({'X-Tenant':'forsyth'}),timeoutMs:15000,queryPolicy:'formatted-pin-v1'});
export const STANLY_SOURCE_URL='https://services6.arcgis.com/w1igg0Q14weqYXUh/arcgis/rest/services/parcel_records_base_2/FeatureServer/3/query';
const MECKLENBURG_FALLBACK_URL='https://gis.charlottenc.gov/arcgis/rest/services/CLT_Ex/CLTEx_MoreInfo/MapServer/4';

// Explicit release policy for the existing Mecklenburg fallback. This is a
// logical source identity, not a fabricated active CountyDataSource row. It is
// allowed only after a successful, complete query returns zero county sources
// and the reviewed registry also records their absence. Query errors must never
// be converted to [] by the caller.
export function resolveMecklenburgFallback({rows,approved,job}) {
  if(!Array.isArray(rows)||rows.length!==0||!Array.isArray(approved)
    ||normalize(job?.county)!=='mecklenburg'||normalize(job?.state)!=='nc'
    ||approved.some(a=>normalize(a.county)==='mecklenburg'&&normalize(a.state)==='nc'))reject();
  const bound={version:1,kind:'virtual',sourceId:'2d5b27d4-6c3f-4cb7-b226-e7a09d7fd9c7',
    state:'nc',county:'mecklenburg',registeredSourceType:'virtual_mecklenburg',
    sourceUrlSha256:hash(MECKLENBURG_FALLBACK_URL),cashDisabled:false,adapterId:'mecklenburg-v1',sourceType:'arcgis_mecklenburg',
    method:'POST',pathTransform:'append_query',timeoutMs:30000,queryPolicy:'frontend-arcgis-v1',
    url:`${MECKLENBURG_FALLBACK_URL}/query`,createdAt:null,secondary:null};
  const source=Object.freeze({...bound,endpointId:'mecklenburg-fallback-v1',endpointConfigDigest:hash(JSON.stringify(bound)),registryUrl:MECKLENBURG_FALLBACK_URL});
  return Object.freeze({sources:Object.freeze([source]),cashDisabled:false});
}

// Both arguments come from trusted server code: rows are one complete active
// county registry query, approved is an independently reviewed release manifest.
// Never construct approval hashes from the same live rows being checked.
// No registry query, environment access, fallback or network occurs here.
export function resolveBuyerSources({rows,approved,job}) {
  if(!Array.isArray(rows)||rows.length<1||rows.length>32||!Array.isArray(approved)
    ||approved.length>1000||!normalize(job?.county)||!/^[A-Za-z]{2}$/.test(job?.state??''))reject();
  const policies=new Map();
  for(const a of approved) {
    if(!a||!uuid(a.sourceId)||policies.has(a.sourceId)||!normalize(a.county)||!/^[A-Za-z]{2}$/.test(a.state??'')
      ||!id(a.registeredSourceType)||!id(a.adapterId)||!id(a.sourceType)
      ||typeof a.sourceUrlSha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sourceUrlSha256)
      ||!timestamp(a.createdAt)
      ||typeof a.cashDisabled!=='boolean'||!['GET','POST'].includes(a.method)
      ||!['strip_query','append_query','preserve_query','stanly_fixed'].includes(a.pathTransform)
      ||(['preserve_query','stanly_fixed'].includes(a.pathTransform)&&a.method!=='GET')
      ||(a.pathTransform==='stanly_fixed'&&(normalize(a.county)!=='stanly'||normalize(a.state)!=='nc'))
      ||!Number.isSafeInteger(a.timeoutMs)||a.timeoutMs<1||a.timeoutMs>30000)reject();
    policies.set(a.sourceId,a);
  }
  const seen=new Set();
  const sources=rows.map(row=>{
    if(!row||!uuid(row.id)||seen.has(row.id)||row.active!==true||typeof row.cash_disabled!=='boolean'
      ||normalize(row.county)!==normalize(job.county)||normalize(row.state)!==normalize(job.state)
      ||!timestamp(row.created_at)
      ||typeof row.source_url!=='string'||row.source_url.length>16384)reject();
    seen.add(row.id);
    const a=policies.get(row.id);
    if(!a||normalize(a.county)!==normalize(row.county)||normalize(a.state)!==normalize(row.state)
      ||row.source_type!==a.registeredSourceType||row.cash_disabled!==a.cashDisabled
      ||timestamp(row.created_at)!==timestamp(a.createdAt)||hash(row.source_url)!==a.sourceUrlSha256)reject();
    let url;try{url=new URL(row.source_url);}catch{reject();}
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||isIP(url.hostname)
      ||!url.hostname.includes('.')||url.hostname.endsWith('.local'))reject();
    url.search='';
    // Explicit Mecklenburg transform; configured query values are deliberately
    // discarded only for these frontend adapters. Generic sources need a
    // separate policy that preserves their reviewed configured query semantics.
    if(a.pathTransform==='append_query')url.pathname+='/query';
    if(a.pathTransform==='stanly_fixed')url=new URL(STANLY_SOURCE_URL);
    const bound={version:1,sourceId:row.id,state:normalize(row.state),county:normalize(row.county),
      registeredSourceType:a.registeredSourceType,sourceUrlSha256:a.sourceUrlSha256,cashDisabled:a.cashDisabled,
      adapterId:a.adapterId,sourceType:a.sourceType,method:a.method,pathTransform:a.pathTransform,timeoutMs:a.timeoutMs,
      queryPolicy:a.pathTransform==='preserve_query'?'registry-generic-v1':'frontend-arcgis-v1',url:url.href,createdAt:timestamp(a.createdAt),
      secondary:a.adapterId==='forsyth-v1'&&normalize(a.county)==='forsyth'&&normalize(a.state)==='nc'?FORSYTH_PARCEL_POLICY:null};
    return Object.freeze({...bound,endpointId:row.id,endpointConfigDigest:hash(JSON.stringify(bound)),
      registryUrl:row.source_url});
  }).sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:(a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0));
  const expected=[...policies.values()].filter(a=>normalize(a.state)===normalize(job.state)&&normalize(a.county)===normalize(job.county));
  if(expected.length!==sources.length||expected.some(a=>!seen.has(a.sourceId)))reject();
  return Object.freeze({sources:Object.freeze(sources),cashDisabled:sources.some(s=>s.cashDisabled)});
}
