const executors=new WeakSet();
const fail=()=>new AdmissionUnavailableError();
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const statements=Object.freeze({
 reserve:Object.freeze({text:'select buyer_writer.reserve_operation($1,$2::uuid,$3::uuid,$4,$5::timestamptz) as accepted',count:5}),
 apply:Object.freeze({text:'select buyer_writer.execute_admitted_apply($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10,$11::jsonb) as result',count:11}),
 issue:Object.freeze({text:'select buyer_writer.execute_admitted_issue($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10::uuid,$11,$12::jsonb,$13::jsonb,$14::timestamptz,$15::uuid) as result',count:15}),
 cancel:Object.freeze({text:'select buyer_writer.execute_admitted_cancel($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10::uuid) as result',count:10}),
 reconcile:Object.freeze({text:'select buyer_writer.execute_admitted_reconcile($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10::uuid,$11::uuid,$12::timestamptz) as result',count:12}),
 receipt:Object.freeze({text:'select buyer_writer.execute_admitted_receipt($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid,$12::uuid,$13::bigint,$14,$15::integer) as result',count:15}),
 correlate:Object.freeze({text:'select buyer_writer.correlate_admission($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9) as result',count:9}),
});

export class AdmissionUnavailableError extends Error {
 constructor(){super('Buyer admission unavailable');this.name='AdmissionUnavailableError';}
}

export const ADMISSION_IDENTITY_SQL=`select (
 session_user=$1 and current_user='buyer_writer_admission'
 and login.rolcanlogin and not(login.rolsuper or login.rolcreatedb or login.rolcreaterole
  or login.rolreplication or login.rolbypassrls or login.rolinherit)
 and not admission.rolcanlogin and not(admission.rolsuper or admission.rolcreatedb
  or admission.rolcreaterole or admission.rolreplication or admission.rolbypassrls or admission.rolinherit)
 and (select count(*) from pg_auth_members m where m.roleid=admission.oid)=2
 and exists(select from pg_auth_members m where m.roleid=admission.oid and m.member=login.oid
  and not m.admin_option and not m.inherit_option and m.set_option and m.grantor=creator.oid)
 and creator.oid=$2::oid and creator.oid=(select datdba from pg_database where datname=current_database())
 and exists(select from pg_auth_members m join pg_roles grantor on grantor.oid=m.grantor
  where m.roleid=admission.oid and m.member=creator.oid and m.admin_option
  and not m.inherit_option and not m.set_option and grantor.rolsuper)
 and not exists(select from pg_auth_members m where m.member=login.oid and m.roleid<>admission.oid)
 and not exists(select from pg_auth_members m where m.member=admission.oid)
 and not exists(select from pg_default_acl d where d.defaclrole in(login.oid,admission.oid)
  and coalesce(array_length(d.defaclacl,1),0)>0)
 and has_schema_privilege(current_user,'buyer_writer','USAGE')
 and has_function_privilege(current_user,'buyer_writer.lock_scope()','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','EXECUTE')
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and has_schema_privilege(current_user,n.oid,'USAGE') and has_function_privilege(current_user,p.oid,'EXECUTE')
  and p.oid<>all(array[
   to_regprocedure('buyer_writer.lock_scope()'),
   to_regprocedure('buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)'),
   to_regprocedure('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)'),
   to_regprocedure('buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)'),
   to_regprocedure('buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)'),
   to_regprocedure('buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)'),
   to_regprocedure('buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)'),
   to_regprocedure('buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)')]))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
  and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not exists(select from pg_database d join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a on true
  where a.grantee=login.oid)
 and has_database_privilege(login.oid,(select oid from pg_database where datname=current_database()),'CONNECT')
 and not has_database_privilege(login.oid,(select oid from pg_database where datname=current_database()),'CREATE')
 and not has_database_privilege(login.oid,(select oid from pg_database where datname=current_database()),'TEMP')
 and exists(select from pg_database d where d.datname='template1' and d.datistemplate and d.datallowconn
  and has_database_privilege(login.oid,d.oid,'CONNECT')
  and not has_database_privilege(login.oid,d.oid,'CREATE')
  and not has_database_privilege(login.oid,d.oid,'TEMP'))
 and not exists(select from pg_database d where d.datname not in(current_database(),'template1')
  and (has_database_privilege(login.oid,d.oid,'CONNECT') or has_database_privilege(login.oid,d.oid,'CREATE')
   or has_database_privilege(login.oid,d.oid,'TEMP')))
 and not exists(select from pg_namespace n join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a on true
  where a.grantee=login.oid)
 and not exists(select from pg_class c join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a on true
  where c.relkind in('r','p','v','m','f','S') and a.grantee=login.oid)
 and not exists(select from pg_proc p join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a on true
  where a.grantee=login.oid)
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and not has_database_privilege(current_user,current_database(),'TEMP')
) as safe
from pg_roles login cross join pg_roles admission cross join pg_roles creator
where login.rolname=session_user and admission.rolname='buyer_writer_admission' and creator.oid=$2::oid`;

function deadline(task,timeoutMs,onExpire){
 let timer,expired=false;
 return Promise.race([
  Promise.resolve().then(task).then(value=>{if(expired)throw fail();return value;}),
  new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;onExpire();reject(fail());},timeoutMs);}),
 ]).finally(()=>clearTimeout(timer));
}

export function createAttestedAdmissionExecutor({expectedLogin,expectedCreatorOid,connect,checkoutTimeoutMs=2000,identityTimeoutMs=2000}={}){
 if(typeof expectedLogin!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(expectedLogin)
  ||expectedLogin==='buyer_writer_admission'||!Number.isInteger(expectedCreatorOid)
  ||expectedCreatorOid<1||expectedCreatorOid>4294967295||typeof connect!=='function'
  ||![checkoutTimeoutMs,identityTimeoutMs].every(value=>Number.isInteger(value)&&value>=10&&value<=5000))throw fail();
 const executor=Object.freeze({expectedLogin,expectedCreatorOid,connect,checkoutTimeoutMs,identityTimeoutMs});
 executors.add(executor);
 return executor;
}
export async function executeAdmission(executor,operation,values,{signal}={}){
 const statement=statements[operation];
 if(!executors.has(executor)||!statement||!Array.isArray(values)||values.length!==statement.count
  ||(signal!==undefined&&!(signal instanceof AbortSignal)))throw fail();
 let client,released=false,destroy=false,checkoutExpired=false;
 const release=force=>{if(client&&!released){released=true;client.release(force);}};
 try{
  client=await deadline(async()=>{
   const value=await executor.connect();
   if(checkoutExpired){try{value?.release?.(true);}catch{}throw fail();}
   return value;
  },executor.checkoutTimeoutMs,()=>{checkoutExpired=true;});
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')throw fail();
  const controller=new AbortController();let identity;
  try{
   identity=await deadline(
    ()=>client.query({text:ADMISSION_IDENTITY_SQL,values:[executor.expectedLogin,executor.expectedCreatorOid],signal:controller.signal}),
    executor.identityTimeoutMs,()=>{destroy=true;controller.abort();});
  }catch{destroy=true;throw fail();}
  if(!identity||!Array.isArray(identity.rows)||identity.rows.length!==1
   ||!exact(identity.rows[0],['safe'])||identity.rows[0].safe!==true){destroy=true;throw fail();}
  if(signal?.aborted)destroy=true;
  signal?.addEventListener('abort',()=>{destroy=true;},{once:true});
  try{return await client.query({text:statement.text,values,...(signal===undefined?{}:{signal})});}
  catch(error){destroy=true;throw error;}
 }catch(error){
  if(error instanceof AdmissionUnavailableError)destroy=true;
  throw error;
 }finally{release(destroy);}
}
