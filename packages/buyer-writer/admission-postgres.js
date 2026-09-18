import {X509Certificate} from 'node:crypto';
import {AdmissionUnavailableError,createAttestedAdmissionExecutor} from './admission-executor.js';

export const BUYER_WRITER_ADMISSION_LOGIN='buyer_writer_admission_login';
export const BUYER_WRITER_ADMISSION_ROLE='buyer_writer_admission';
export const ADMISSION_TEMPLATE1_IDENTITY_SQL=`select (
 session_user=$1 and current_user='buyer_writer_admission' and current_database()='template1'
 and login.rolcanlogin and not(login.rolsuper or login.rolcreatedb or login.rolcreaterole
  or login.rolreplication or login.rolbypassrls or login.rolinherit)
 and not admission.rolcanlogin and not(admission.rolsuper or admission.rolcreatedb or admission.rolcreaterole
  or admission.rolreplication or admission.rolbypassrls or admission.rolinherit)
 and d.datistemplate and d.datallowconn and d.datdba=10
 and coalesce((select rolsuper from pg_roles where oid=10),false)
 and has_database_privilege(current_user,d.oid,'CONNECT')
 and not has_database_privilege(current_user,d.oid,'CREATE')
 and not has_database_privilege(current_user,d.oid,'TEMP')
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and n.nspname<>'public' and has_schema_privilege(current_user,n.oid,'USAGE'))
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
  and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and c.relkind in('r','p','v','m','f')
  and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema' and c.relkind='S'
  and has_sequence_privilege(current_user,c.oid,'SELECT,UPDATE,USAGE'))
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
  and has_function_privilege(current_user,p.oid,'EXECUTE'))
) as safe from pg_database d cross join pg_roles login cross join pg_roles admission
where d.datname=current_database() and login.rolname=$1 and admission.rolname='buyer_writer_admission'`;
const unavailable=()=>new AdmissionUnavailableError();
const allowedKeys=['host','port','database','user','password','ca'];

function validCertificateBundle(value){
 if(typeof value!=='string'||value.length<1||value.length>65536||value.includes('\0'))return false;
 const certificates=value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
 if(!certificates?.length||value.replaceAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())return false;
 try{for(const certificate of certificates)new X509Certificate(certificate);return true;}catch{return false;}
}

function validateConnection(value){
 if(!value||typeof value!=='object'||Array.isArray(value)
  ||Object.keys(value).length!==allowedKeys.length
  ||!allowedKeys.every(key=>Object.hasOwn(value,key))
  ||Object.keys(value).some(key=>!allowedKeys.includes(key))
  ||typeof value.host!=='string'||value.host.length>253
  ||!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host)
  ||!Number.isInteger(value.port)||value.port<1||value.port>65535
  ||typeof value.database!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(value.database)
  ||value.user!==BUYER_WRITER_ADMISSION_LOGIN
  ||typeof value.password!=='string'||value.password.length<1||value.password.length>1024
  ||value.password.includes('\0')||!validCertificateBundle(value.ca))throw unavailable();
 return Object.freeze({...value});
}

function poolConfiguration(connection){
 return Object.freeze({
  host:connection.host,port:connection.port,database:connection.database,
  user:BUYER_WRITER_ADMISSION_LOGIN,password:connection.password,
  ssl:Object.freeze({rejectUnauthorized:true,ca:connection.ca}),
  application_name:'blackspire-buyer-writer-admission',
  client_encoding:'UTF8',
  options:`-c role=${BUYER_WRITER_ADMISSION_ROLE} -c statement_timeout=10000 -c lock_timeout=5000 -c search_path=pg_catalog -c idle_in_transaction_session_timeout=10000`,
  connectionTimeoutMillis:2000,query_timeout:11000,idleTimeoutMillis:10000,
  max:2,maxUses:100,maxLifetimeSeconds:60,
 });
}

export async function createBuyerWriterAdmissionPostgres({connection,expectedCreatorOid,Pool}={}){
 const config=poolConfiguration(validateConnection(connection));
 let pool,templatePool,closed=false,healthy=true,closing;
 const checkedOut=new Set();
 const close=()=>{
  if(closing)return closing;
  closed=true;
  for(const destroy of [...checkedOut])destroy();
  let timer;
  closing=Promise.race([
   Promise.resolve().then(()=>Promise.all([pool?.end(),templatePool?.end()])).catch(()=>{throw unavailable();}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),2000);}),
  ]).finally(()=>clearTimeout(timer));
  return closing;
 };
 try{
  const DriverPool=Pool??(await import('pg')).Pool;
  if(typeof DriverPool!=='function')throw unavailable();
  pool=new DriverPool(config);
  if(!pool||typeof pool.connect!=='function'||typeof pool.end!=='function'
   ||typeof pool.on!=='function')throw unavailable();
  pool.on('error',()=>{healthy=false;});
  templatePool=new DriverPool({...config,database:'template1',application_name:'blackspire-buyer-writer-admission-template-attestation',max:1});
  if(!templatePool||typeof templatePool.connect!=='function'||typeof templatePool.end!=='function'
   ||typeof templatePool.on!=='function')throw unavailable();
  templatePool.on('error',()=>{healthy=false;});
  let templateClient;
  try{
   templateClient=await templatePool.connect();
   if(!templateClient||typeof templateClient.query!=='function'||typeof templateClient.release!=='function')throw unavailable();
   const result=await templateClient.query({text:ADMISSION_TEMPLATE1_IDENTITY_SQL,values:[BUYER_WRITER_ADMISSION_LOGIN]});
   if(!result||!Array.isArray(result.rows)||result.rows.length!==1
    ||!result.rows[0]||typeof result.rows[0]!=='object'||Array.isArray(result.rows[0])
    ||Object.keys(result.rows[0]).length!==1||result.rows[0].safe!==true)throw unavailable();
   templateClient.release(false);templateClient=undefined;
  }catch{
   try{templateClient?.release?.(true);}catch{}
   throw unavailable();
  }
  const connect=async()=>{
   if(closed||!healthy)throw unavailable();
   let client;
   try{client=await pool.connect();}catch{throw unavailable();}
   if(!client||typeof client.query!=='function'||typeof client.release!=='function'){
    try{client?.release?.(true);}catch{}
    throw unavailable();
   }
   const originalRelease=client.release.bind(client);
   const originalQuery=client.query.bind(client);let released=false;
   const release=destroy=>{
    if(released)return;
    released=true;checkedOut.delete(forceDestroy);
    client.release=originalRelease;
    if(!destroy)client.query=originalQuery;
    originalRelease(Boolean(destroy));
   };
   const forceDestroy=()=>{try{release(true);}catch{}};
   client.query=(...args)=>{
    if(closed||!healthy||released)throw unavailable();
    return originalQuery(...args);
   };
   client.release=release;checkedOut.add(forceDestroy);
   if(closed||!healthy){forceDestroy();throw unavailable();}
   return client;
  };
  const executor=createAttestedAdmissionExecutor({
   expectedLogin:BUYER_WRITER_ADMISSION_LOGIN,expectedCreatorOid,connect,
   checkoutTimeoutMs:2000,identityTimeoutMs:2000,
  });
  return Object.freeze({
   executor,isHealthy:()=>!closed&&healthy,
   close,
  });
 }catch{
  try{await close();}catch{}
  throw unavailable();
 }
}
