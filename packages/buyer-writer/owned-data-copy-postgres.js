import {createHash} from 'node:crypto';
import {OWNED_BUYER_RELATIONS,OWNED_BUYER_COPY_ORDER} from './owned-data-migration.js';
const reject=()=>{throw new Error('Owned Buyer PostgreSQL copy rejected');};
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const table=name=>{if(!OWNED_BUYER_RELATIONS.includes(name))reject();return `public.${quote(name)}`;};
const client=value=>{if(!value||typeof value.query!=='function'||!Number.isSafeInteger(value.processID)||value.processID<1)reject();};
const hash=()=>createHash('sha256');

// These primitives accept already connected dedicated sessions only. Credentials,
// cluster/profile proofs, immutable schema restoration, durable intent and cutover
// fencing belong to the reviewed host, not query text or caller environment.
export async function holdOwnedBuyerSourceSnapshot(source){
 client(source);let began=false;
 try{
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ');began=true;
  await source.query("SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='60s'");
  // SHARE locks prevent INSERT/UPDATE/DELETE and DDL across the complete closure.
  // They remain held until source ROLLBACK; external write revocation must remain
  // in force after that rollback. Locks alone are not a permanent authority switch.
  await source.query(`LOCK TABLE ${OWNED_BUYER_COPY_ORDER.map(table).join(',')} IN SHARE MODE`);
  const response=await source.query('SELECT pg_export_snapshot() AS snapshot');
  const snapshotId=response.rows?.[0]?.snapshot;
  if(response.rows?.length!==1||typeof snapshotId!=='string'||!/^[A-Za-z0-9:-]{1,128}$/.test(snapshotId))reject();
  return Object.freeze({snapshotId});
 }catch{if(began)try{await source.query('ROLLBACK');}catch{}throw new Error('Owned Buyer source snapshot failed');}
}

export async function inspectOwnedBuyerColumns(connection,name){
 client(connection);
 const result=await connection.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,a.attgenerated AS generated,a.attidentity AS identity
 FROM pg_attribute a WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[table(name)]);
 if(!Array.isArray(result.rows)||result.rows.length<1||result.rows.length>128)reject();
 const names=new Set();
 for(const row of result.rows){if(typeof row.name!=='string'||!row.name||row.name.length>63||names.has(row.name)
  ||typeof row.type!=='string'||typeof row.required!=='boolean'||row.generated!==''||row.identity!=='')reject();names.add(row.name);}
 if(!names.has('id'))reject();
 return Object.freeze(result.rows.map(row=>Object.freeze({...row})));
}

// Cursor batches bound retained memory; JSON is transported as raw text, so
// PostgreSQL numeric precision, arrays, nulls and timestamp values never pass
// through JavaScript number conversion. Explicit full columns preserve IDs and
// defaults. Generated/identity columns refuse until separately supported.
export async function transferOwnedBuyerRelation({source,target,name,expected,columns,copy=true}){
 client(source);if(copy)client(target);
 if((copy&&!expected)||(expected&&(!Number.isSafeInteger(expected.rowCount)||expected.rowCount<0||!/^[a-f0-9]{64}$/.test(expected.dataDigest??'')))
  ||!Array.isArray(columns)||!columns.length||columns.length>128||!columns.every(c=>typeof c.name==='string'&&c.generated===''&&c.identity===''))reject();
 const actual=await inspectOwnedBuyerColumns(source,name);
 if(JSON.stringify(actual)!==JSON.stringify(columns))reject();
 if(copy&&JSON.stringify(await inspectOwnedBuyerColumns(target,name))!==JSON.stringify(columns))reject();
 const cursor='owned_buyer_copy';let open=false,count=0;const digest=hash();
 try{
  await source.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row FROM ${table(name)} t ORDER BY id`);open=true;
  for(;;){
   const batch=await source.query(`FETCH FORWARD 128 FROM ${cursor}`);
   if(!Array.isArray(batch.rows)||batch.rows.length>128)reject();if(!batch.rows.length)break;
   for(const item of batch.rows){
    if(typeof item.row!=='string'||Buffer.byteLength(item.row)>2*1024*1024||++count>(expected?.rowCount??Number.MAX_SAFE_INTEGER))reject();
    digest.update(item.row);digest.update('\n');
    if(copy){
     const names=columns.map(c=>quote(c.name)).join(',');
     const inserted=await target.query(`INSERT INTO ${table(name)} (${names}) SELECT ${names} FROM json_populate_record(NULL::${table(name)},$1::json)`,[item.row]);
     if(inserted.rowCount!==1)reject();
    }
   }
  }
  const dataDigest=digest.digest('hex');if(expected&&(count!==expected.rowCount||dataDigest!==expected.dataDigest))reject();
  return Object.freeze({name,rowCount:count,dataDigest});
 }catch{throw new Error('Owned Buyer relation transfer failed');}
 finally{if(open)await source.query(`CLOSE ${cursor}`);}
}

export async function inspectOwnedBuyerDataSnapshot(source){
 const relations=[];
 for(const name of OWNED_BUYER_RELATIONS){
  const columns=await inspectOwnedBuyerColumns(source,name);
  const evidence=await transferOwnedBuyerRelation({source,name,columns,copy:false});
  relations.push(Object.freeze({...evidence,columns}));
 }
 return Object.freeze(relations);
}
