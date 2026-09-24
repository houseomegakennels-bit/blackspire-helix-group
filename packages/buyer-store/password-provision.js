import {fail} from './local-protocol.js';
export const BUYER_STORE_LOGIN_ROLES=['buyer_repository_login','buyer_capability_login'];
// Durable adapter persists intent BEFORE SQL and verifies exact retained intent.
// Unknown outcomes only reconcile through fresh retained-password authentication.
export async function provisionBuyerStorePasswords({management,verifyIdentity,observeFresh,verifyPasswords,journal,passwords,fence=async()=>{}}){
 const roles=BUYER_STORE_LOGIN_ROLES;
 if(!Array.isArray(passwords)||passwords.length!==2||passwords[0]===passwords[1]||passwords.some(p=>typeof p!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p)))fail();
 if(!await journal.hasIntent()){
  await fence();await verifyIdentity();
  await management.query('BEGIN');
  try{
   await management.query("SELECT pg_advisory_xact_lock(hashtextextended('blackspire-buyer-store-provision-v1',0))");
   const r=await management.query('SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[roles]);
   if(r.rows.length!==2||r.rows.some(v=>!v.rolcanlogin||v.rolsuper||v.rolcreaterole||v.rolcreatedb||v.rolreplication||v.rolbypassrls))fail();
   if(await observeFresh()!==true)fail();
   await fence();await journal.writeIntent();
   for(const [index,user] of roles.entries())await management.query('ALTER ROLE '+user+" PASSWORD '"+passwords[index]+"'");
   await fence();await management.query('COMMIT');
  }catch{await management.query('ROLLBACK').catch(()=>{});fail();}
 }else await journal.verifyIntent();
 await fence();await verifyPasswords();await fence();
 await journal.writeResult();
 return {status:'VERIFIED'};
}
