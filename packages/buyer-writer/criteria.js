import { canonicalBuyerSaleDate } from './dates.js';
import { BuyerSourceError } from './source-http.js';
const reject=()=>{throw new BuyerSourceError('SOURCE_POLICY_REJECTED');};
const fields=['state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only'];

// Capture BEFORE any asynchronous acquisition. Preserve PostgreSQL nulls and
// the complete timestamp string; JavaScript Date truncates microsecond fencing.
// SQL compares these expected values to the locked canonical job before issuing.
export function captureBuyerJobVersion(job) {
  if(!job||typeof job!=='object'||Array.isArray(job)||!Object.hasOwn(job,'updated_at')
    ||fields.some(k=>!Object.hasOwn(job,k)))reject();
  const criteria=Object.fromEntries(fields.map(k=>[k,job[k]]));
  if(typeof criteria.state!=='string'||!/^[A-Z]{2}$/.test(criteria.state)
    ||['county','property_type'].some(k=>typeof criteria[k]!=='string'||criteria[k].length<1||criteria[k].length>128)
    ||criteria.min_purchases!==null&&(!Number.isSafeInteger(criteria.min_purchases)||criteria.min_purchases<1||criteria.min_purchases>5)
    ||['cash_buyers_only','llc_buyers_only'].some(k=>criteria[k]!==null&&typeof criteria[k]!=='boolean'))reject();
  try {
    for(const key of ['date_range_start','date_range_end'])if(typeof criteria[key]!=='string'||canonicalBuyerSaleDate(criteria[key])!==criteria[key])reject();
  }catch{reject();}
  if(criteria.date_range_start>criteria.date_range_end)reject();
  const updatedAt=job.updated_at;
  validateBuyerJobRevision(updatedAt);
  return Object.freeze({criteria:Object.freeze(criteria),updatedAt});
}

export function validateBuyerJobRevision(updatedAt) {
  if(updatedAt!==null) {
    const match=typeof updatedAt==='string'&&/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(updatedAt);
    if(!match)reject();
    const base=`${match[1]}T${match[2]}`;const date=new Date(`${base}Z`);
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==base)reject();
  }
  return updatedAt;
}
