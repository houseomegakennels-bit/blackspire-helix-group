import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {prepareOwnedBuyerSchema} from '../packages/buyer-writer/owned-schema.js';
import {holdOwnedBuyerSourceSnapshot,inspectOwnedBuyerDataSnapshot,transferOwnedBuyerRelation} from '../packages/buyer-writer/owned-data-copy-postgres.js';
import {OWNED_BUYER_COPY_ORDER} from '../packages/buyer-writer/owned-data-migration.js';
assert.equal(process.env.ZOLA_DISPOSABLE_EXECUTOR,'1');assert.equal(process.versions.node,'22.23.1');
const ports=JSON.parse(fs.readFileSync(0,'utf8'));assert.ok([ports.source,ports.target].every(p=>/^172\.[0-9]+\.[0-9]+\.[0-9]+$/.test(p)));assert.notEqual(ports.source,ports.target);
const clients=[];const connect=async database=>{const c=new pg.Client({host:database==='owned_fixture'?ports.target:ports.source,port:5432,user:'postgres',database:'postgres',connectionTimeoutMillis:2000,query_timeout:35000});await c.connect();clients.push(c);return c;};
try{
 const source=await connect('postgres');
 const body=prepareOwnedBuyerSchema(JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)))).body;
 await source.query(body);
 const target=await connect('owned_fixture');await target.query(body);
 const owner='00000000-0000-4000-8000-000000000001',job='00000000-0000-4000-8000-000000000002',buyer='00000000-0000-4000-8000-000000000003';
 await source.query('INSERT INTO public."SearchJob"(id,user_id,state,county,property_type) VALUES($1,$2,$3,$4,$5)',[job,owner,'TX','Synthetic','home']);
 await source.query('INSERT INTO public."BuyerProfile"(id,buyer_name,total_spend,updated_at) VALUES($1,$2,123456789012345678901234567890.1234567890123456789,$3)',[buyer,'Synthetic','2026-09-21T00:00:00.123456Z']);
 await source.query('INSERT INTO public."BuyerReport"(search_job_id,buyer_profile_id) VALUES($1,$2)',[job,buyer]);
 for(const name of ['RawSale','CleanSale'])await source.query(`INSERT INTO public."${name}"(search_job_id) VALUES($1)`,[job]);
 await source.query('INSERT INTO public.exports(user_id,search_job_id,file_name,storage_path) VALUES($1,$2,$3,$4)',[owner,job,'fixture.csv','synthetic/path']);
 await holdOwnedBuyerSourceSnapshot(source);const snapshot=await inspectOwnedBuyerDataSnapshot(source);
 const competing=await connect('postgres');await competing.query("SET lock_timeout='100ms'");await assert.rejects(competing.query('UPDATE public."SearchJob" SET status=$1 WHERE id=$2',['processing',job]),error=>error.code==='55P03');
 await target.query("BEGIN;SET LOCAL timezone='UTC'");
 for(const name of OWNED_BUYER_COPY_ORDER){const evidence=snapshot.find(row=>row.name===name);await transferOwnedBuyerRelation({source,target,name,expected:evidence,columns:evidence.columns});}
 assert.deepEqual(await inspectOwnedBuyerDataSnapshot(target),snapshot);
 await target.query('COMMIT');await source.query('ROLLBACK');
 assert.equal((await target.query('SELECT total_spend::text AS n,to_char(updated_at,\'US\') AS micros FROM public."BuyerProfile"')).rows[0].n,'123456789012345678901234567890.1234567890123456789');
 assert.equal((await target.query('SELECT to_char(updated_at,\'US\') AS micros FROM public."BuyerProfile"')).rows[0].micros,'123456');
 await target.query('BEGIN;SET LOCAL ROLE authenticated');await target.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner]);assert.equal((await target.query('SELECT id FROM public."SearchJob"')).rowCount,1);await target.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[buyer]);assert.equal((await target.query('SELECT id FROM public."SearchJob"')).rowCount,0);assert.equal((await target.query('SELECT id FROM public.exports')).rowCount,0);await target.query('ROLLBACK');
 await target.query('DELETE FROM public."BuyerReport"');await target.query('DELETE FROM public."RawSale"');await target.query('DELETE FROM public."CleanSale"');await target.query('DELETE FROM public."SearchJob"');assert.equal((await target.query('SELECT id FROM public.exports')).rowCount,0);
 console.log(JSON.stringify({status:'PASS',checks:['actual generated schema/FKs/RLS','six-table exact copy and IDs','numeric and microsecond preservation','source write lock','owner/foreign RLS','exports cascade'],productionConnections:0}));
}finally{for(const c of clients)try{await c.end();}catch{}}
