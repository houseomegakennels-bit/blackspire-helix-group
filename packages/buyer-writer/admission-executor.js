const executors=new WeakSet();
const fail=()=>new AdmissionUnavailableError();
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export class AdmissionUnavailableError extends Error {
 constructor(){super('Buyer admission unavailable');this.name='AdmissionUnavailableError';}
}

export const ADMISSION_IDENTITY_SQL=`select (
 session_user=$1 and current_user='buyer_writer_admission'
 and login.rolcanlogin and not(login.rolsuper or login.rolcreatedb or login.rolcreaterole
  or login.rolreplication or login.rolbypassrls or login.rolinherit)
 and not admission.rolcanlogin and not(admission.rolsuper or admission.rolcreatedb
  or admission.rolcreaterole or admission.rolreplication or admission.rolbypassrls or admission.rolinherit)
 and exists(select from pg_auth_members m where m.roleid=admission.oid and m.member=login.oid
  and not m.admin_option and not m.inherit_option and m.set_option)
 and not exists(select from pg_auth_members m join pg_roles r on r.oid=m.roleid
  where m.member=login.oid and r.rolname<>'buyer_writer_admission')
 and has_schema_privilege(current_user,'buyer_writer','USAGE')
 and has_function_privilege(current_user,'buyer_writer.lock_scope()','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','EXECUTE')
 and has_function_privilege(current_user,'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','EXECUTE')
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and has_schema_privilege(current_user,n.oid,'USAGE') and has_function_privilege(current_user,p.oid,'EXECUTE')
  and p.oid<>all(array[
   to_regprocedure('buyer_writer.lock_scope()'),
   to_regprocedure('buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)'),
   to_regprocedure('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)'),
   to_regprocedure('buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)')]))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
  and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and not has_database_privilege(current_user,current_database(),'TEMP')
) as safe
from pg_roles login cross join pg_roles admission
where login.rolname=session_user and admission.rolname='buyer_writer_admission'`;

function deadline(task,timeoutMs,onExpire){
 let timer,expired=false;
 return Promise.race([
  Promise.resolve().then(task).then(value=>{if(expired)throw fail();return value;}),
  new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;onExpire();reject(fail());},timeoutMs);}),
 ]).finally(()=>clearTimeout(timer));
}

export function createAttestedAdmissionExecutor({expectedLogin,connect,checkoutTimeoutMs=2000,identityTimeoutMs=2000}={}){
 if(typeof expectedLogin!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(expectedLogin)
  ||expectedLogin==='buyer_writer_admission'||typeof connect!=='function'
  ||![checkoutTimeoutMs,identityTimeoutMs].every(value=>Number.isInteger(value)&&value>=10&&value<=5000))throw fail();
 const executor=Object.freeze({expectedLogin,connect,checkoutTimeoutMs,identityTimeoutMs});
 executors.add(executor);
 return executor;
}

export const isAttestedAdmissionExecutor=executor=>executors.has(executor);

export async function runAttestedAdmission(executor,work){
 if(!executors.has(executor)||typeof work!=='function')throw fail();
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
    ()=>client.query({text:ADMISSION_IDENTITY_SQL,values:[executor.expectedLogin],signal:controller.signal}),
    executor.identityTimeoutMs,()=>{destroy=true;controller.abort();});
  }catch{destroy=true;throw fail();}
  if(!identity||!Array.isArray(identity.rows)||identity.rows.length!==1
   ||!exact(identity.rows[0],['safe'])||identity.rows[0].safe!==true){destroy=true;throw fail();}
  const query=(text,values,{signal}={})=>{
   if(typeof text!=='string'||!Array.isArray(values))throw fail();
   if(signal!==undefined&&!(signal instanceof AbortSignal))throw fail();
   if(signal?.aborted)destroy=true;
   signal?.addEventListener('abort',()=>{destroy=true;},{once:true});
   return client.query({text,values,...(signal===undefined?{}:{signal})}).catch(error=>{destroy=true;throw error;});
  };
  return await work(query);
 }catch(error){
  if(error instanceof AdmissionUnavailableError)destroy=true;
  throw error;
 }finally{
  release(destroy);
 }
}
