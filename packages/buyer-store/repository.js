import {validateBuyerStoreInput,refuse} from './service.js';
const JOB='id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,total_buyers_found,total_sales_analyzed,error_message,created_at,updated_at';
const PROFILE='p.id,p.buyer_name,p.county,p.state,p.is_llc,p.is_cash_buyer,p.purchase_count,p.total_spend,p.last_purchase_date,p.property_types,p.score';
const REPORT='r.id,r.search_job_id,r.buyer_profile_id,r.buyer_name_snapshot,r.mailing_address_snapshot,r.score,r.purchase_count,r.total_spend,r.is_llc,r.is_cash_buyer,r.created_at,jsonb_build_object(\'score_breakdown\',p.score_breakdown) AS "BuyerProfile"';
const EXPORT='id,user_id,search_job_id,file_name,storage_path,row_count,created_at';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const escapeLike=v=>v===null?null:v.replace(/[\\%_]/g,'\\$&');
export function createBuyerStoreRepository({connect,connectCapability}){
 if(typeof connect!=='function')refuse();
 const execute=async (operation,raw,ownerId)=>{
  const input=validateBuyerStoreInput(operation,raw);if(!uuid(ownerId)&&!(ownerId===null&&operation==='profiles-list'))refuse();
  let client,begun=false;
  try{
   client=await (ownerId===null?connectCapability():connect());await client.query(['job-create','export-create'].includes(operation)?'BEGIN':'BEGIN READ ONLY');begun=true;
   const identity=(await client.query('SELECT current_user,session_user')).rows[0];
   const login=ownerId===null?'buyer_capability_login':'buyer_repository_login';
   if(identity.current_user!==login||identity.session_user!==login)refuse();
   await client.query(ownerId===null?'SET LOCAL ROLE buyer_capability_reader':'SET LOCAL ROLE buyer_repository_user');
   await client.query("SET LOCAL statement_timeout='8000ms'; SET LOCAL lock_timeout='1000ms'; SET LOCAL search_path=pg_catalog,public");
   await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
   let data;
   let requests=0,responseBytes=0;const started=Date.now();
   const q=async(sql,args)=>{const rows=(await client.query(sql,args)).rows;if(/^SELECT/.test(sql)){requests++;responseBytes+=Buffer.byteLength(JSON.stringify(rows));}return rows;};
   if(operation==='jobs-list')data=await q(`SELECT ${JOB} FROM public."SearchJob" WHERE user_id=$1::uuid AND (cardinality($2::uuid[])=0 OR id=ANY($2::uuid[])) ORDER BY created_at DESC,id LIMIT $3`,[ownerId,input.ids,input.limit]);
   if(operation==='job-get')data=(await q(`SELECT ${JOB} FROM public."SearchJob" WHERE user_id=$1::uuid AND id=$2::uuid`,[ownerId,input.id]))[0]??null;
   if(operation==='job-create'){
    const values=[input.id,ownerId,input.state,input.county,input.property_type,input.date_range_start,input.date_range_end,input.min_purchases,input.cash_buyers_only,input.llc_buyers_only];
    await q('INSERT INTO public."SearchJob"(id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::date,$7::date,$8,$9,$10,\'pending\',clock_timestamp(),clock_timestamp()) ON CONFLICT(id) DO NOTHING',values);
    data=(await q(`SELECT ${JOB} FROM public."SearchJob" WHERE id=$1::uuid AND user_id=$2::uuid AND state=$3 AND county=$4 AND property_type=$5 AND date_range_start IS NOT DISTINCT FROM $6::date AND date_range_end IS NOT DISTINCT FROM $7::date AND min_purchases=$8 AND cash_buyers_only=$9 AND llc_buyers_only=$10`,values))[0];if(!data)refuse();
   }
   if(operation==='reports-list'){
    const args=[ownerId,input.searchJobId];
    const count=await q('SELECT count(*)::integer AS total FROM public."BuyerReport" r JOIN public."SearchJob" j ON j.id=r.search_job_id WHERE j.user_id=$1::uuid AND ($2::uuid IS NULL OR j.id=$2::uuid)',args);
    const reports=await q(`SELECT ${REPORT} FROM public."BuyerReport" r JOIN public."SearchJob" j ON j.id=r.search_job_id LEFT JOIN public."BuyerProfile" p ON p.id=r.buyer_profile_id WHERE j.user_id=$1::uuid AND ($2::uuid IS NULL OR j.id=$2::uuid) ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`,[...args,input.limit,input.offset]);
    data={reports,total:count[0].total,limit:input.limit,offset:input.offset};
   }
   if(operation==='exports-list')data=await q(`SELECT ${EXPORT} FROM public.exports WHERE user_id=$1::uuid AND ($2::uuid IS NULL OR search_job_id=$2::uuid) ORDER BY created_at DESC,id LIMIT $3`,[ownerId,input.searchJobId,input.limit]);
   if(operation==='export-create'){
    const args=[input.id,ownerId,input.searchJobId,input.fileName,input.storagePath,input.rowCount];
    await q('INSERT INTO public.exports(id,user_id,search_job_id,file_name,storage_path,row_count,created_at) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,clock_timestamp() WHERE $3::uuid IS NULL OR EXISTS(SELECT 1 FROM public."SearchJob" WHERE id=$3::uuid AND user_id=$2::uuid) ON CONFLICT(id) DO NOTHING',args);
    data=(await q(`SELECT ${EXPORT} FROM public.exports WHERE id=$1::uuid AND user_id=$2::uuid AND search_job_id IS NOT DISTINCT FROM $3::uuid AND file_name=$4 AND storage_path=$5 AND row_count=$6`,args))[0];if(!data)refuse();
   }
   if(operation==='counts')data=(await q('SELECT (SELECT count(*)::integer FROM public."SearchJob" WHERE user_id=$1::uuid) AS "searchJobCount",(SELECT count(*)::integer FROM public."SearchJob" WHERE user_id=$1::uuid AND status=\'completed\') AS "completedJobCount",(SELECT count(*)::integer FROM public."SearchJob" WHERE user_id=$1::uuid AND status=\'processing\') AS "processingJobCount",(SELECT count(*)::integer FROM public."SearchJob" WHERE user_id=$1::uuid AND status=\'failed\') AS "failedJobCount",(SELECT count(*)::integer FROM public."BuyerReport" r JOIN public."SearchJob" j ON j.id=r.search_job_id WHERE j.user_id=$1::uuid) AS "buyerReportCount",(SELECT count(*)::integer FROM public.exports WHERE user_id=$1::uuid) AS "exportCount"',[ownerId]))[0];
   if(operation==='profiles-list'){
    const where="($1::text IS NULL OR p.county ILIKE '%'||$1||'%') AND ($2::text IS NULL OR p.state ILIKE $2) AND ($3::text IS NULL OR p.buyer_name ILIKE '%'||$3||'%') AND ($4::text IS NULL OR p.property_types @> ARRAY[$4]::text[]) AND ($5::boolean IS NULL OR p.is_cash_buyer=$5) AND ($6::boolean IS NULL OR p.is_llc=$6)";
    const args=[escapeLike(input.county),escapeLike(input.state),escapeLike(input.buyerName),input.propertyType,input.cashBuyer,input.llcBuyer];
    data={rows:await q(`SELECT ${PROFILE} FROM public."BuyerProfile" p WHERE ${where} ORDER BY p.purchase_count DESC NULLS LAST,p.id LIMIT $7`,[...args,input.limit]),count:(await q(`SELECT count(*)::integer AS n FROM public."BuyerProfile" p WHERE ${where}`,args))[0].n};
   }
   if(data===undefined||Buffer.byteLength(JSON.stringify(data))>512*1024)refuse();
   await client.query('COMMIT');begun=false;return ownerId===null?{...data,observation:{requests,responseBytes,latencyMs:Date.now()-started}}:data;
  }catch{if(begun)try{await client.query('ROLLBACK');}catch{}refuse();}
  finally{if(client)await client.end();}
 };
 return Object.freeze({execute(operation,input,ownerId){if(!uuid(ownerId))refuse();return execute(operation,input,ownerId);},readCapabilityProfiles(input){return execute('profiles-list',input,null);}});
}
