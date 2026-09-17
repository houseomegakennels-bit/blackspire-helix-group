import {X509Certificate} from 'node:crypto';
import {AdmissionUnavailableError,createAttestedAdmissionExecutor} from './admission-executor.js';

export const BUYER_WRITER_ADMISSION_LOGIN='buyer_writer_admission_login';
export const BUYER_WRITER_ADMISSION_ROLE='buyer_writer_admission';
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

export async function createBuyerWriterAdmissionPostgres({connection,Pool}={}){
 const config=poolConfiguration(validateConnection(connection));
 let pool,closed=false,healthy=true,closing;
 const checkedOut=new Set();
 const close=()=>{
  if(closing)return closing;
  closed=true;
  for(const destroy of [...checkedOut])destroy();
  let timer;
  closing=Promise.race([
   Promise.resolve().then(()=>pool?.end()).catch(()=>{throw unavailable();}),
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
   expectedLogin:BUYER_WRITER_ADMISSION_LOGIN,connect,
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
