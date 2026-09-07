// PostgreSQL date input retains the calendar-date portion of an ISO timestamp;
// it does not move that date across midnight using the timestamp's UTC offset.
// Epoch-based county adapters already convert their timestamps to UTC dates.
export function canonicalBuyerSaleDate(value) {
  if(value===null) return null;
  if(typeof value!=='string'||value.length>64)throw new Error('Buyer source date rejected');
  const match=/^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$/.exec(value);
  if(!match||match[1].startsWith('0000-'))throw new Error('Buyer source date rejected');
  const date=new Date(`${match[1]}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==match[1])throw new Error('Buyer source date rejected');
  if(match[2]!==undefined) {
    if(Number(match[2])>23||Number(match[3])>59||Number(match[4]??0)>59)throw new Error('Buyer source date rejected');
    const timestamp=value.replace(' ','T')+(match[5]?'':'Z');
    if(!Number.isFinite(new Date(timestamp).getTime()))throw new Error('Buyer source date rejected');
  }
  return match[1];
}
