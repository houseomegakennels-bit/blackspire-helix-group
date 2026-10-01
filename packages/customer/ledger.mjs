import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {privateDirectory,readPrivate,fail} from './private-files.mjs';
export function openLedger(root,installationId){
 const directory=path.join(root,'data');privateDirectory(directory);const file=path.join(directory,'customer-ai.sqlite');
 try{const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;}
 readPrivate(file,64*1024*1024);
 for(const suffix of ['-journal','-wal','-shm'])if(fs.existsSync(file+suffix))readPrivate(file+suffix,64*1024*1024);
 const db=new DatabaseSync(file);
 try{db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
 db.exec('CREATE TABLE IF NOT EXISTS identity(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,month TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,actual INTEGER,result TEXT,created INTEGER NOT NULL);');
 db.exec('BEGIN IMMEDIATE');try{const rows=db.prepare('SELECT id FROM identity').all();if(rows.length===0)db.prepare('INSERT INTO identity VALUES(?)').run(installationId);else if(rows.length!==1||rows[0].id!==installationId)fail('LEDGER_IDENTITY_MISMATCH');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }catch(e){db.close();throw e;}
 return {
 reserve({id,fingerprint,amount,limit,now}){
  db.exec('BEGIN IMMEDIATE');try{
   const old=db.prepare('SELECT * FROM requests WHERE id=?').get(id);
   if(old){if(old.fingerprint!==fingerprint)fail('REQUEST_ID_CONFLICT');if(old.state!=='completed')fail('REQUEST_OUTCOME_UNRESOLVED');db.exec('COMMIT');return {replay:JSON.parse(old.result)};}
   if(db.prepare("SELECT 1 FROM requests WHERE state IN ('unknown','overrun') LIMIT 1").get())fail('BILLING_REVIEW_REQUIRED');
   const month=new Date(now).toISOString().slice(0,7);
   // Old pending reservations block month rollover until explicitly reconciled.
   if(db.prepare("SELECT 1 FROM requests WHERE state='pending' AND month<>? LIMIT 1").get(month))fail('BILLING_REVIEW_REQUIRED');
   const spent=db.prepare('SELECT COALESCE(sum(reserved),0) total FROM requests WHERE month=?').get(month).total;
   if(spent+amount>limit)fail('MONTHLY_BUDGET_EXCEEDED');
   if(db.prepare('SELECT count(*) n FROM requests').get().n>=10000)fail('LEDGER_MAINTENANCE_REQUIRED');
   db.prepare("INSERT INTO requests(id,fingerprint,month,state,reserved,created) VALUES(?,?,?,'pending',?,?)").run(id,fingerprint,month,amount,now);db.exec('COMMIT');return {reserved:amount};
  }catch(e){db.exec('ROLLBACK');throw e;}
 },
 finish(id,{state,actual=null,result=null}){if(!['completed','unknown','overrun'].includes(state))fail('LEDGER_STATE_INVALID');const r=db.prepare("UPDATE requests SET state=?,actual=?,result=? WHERE id=? AND state='pending'").run(state,actual,result===null?null:JSON.stringify(result),id);if(r.changes!==1)fail('LEDGER_TRANSITION_INVALID');},
 summary(now=Date.now()){const month=new Date(now).toISOString().slice(0,7);return {month,...db.prepare('SELECT COALESCE(sum(reserved),0) reservedMicroUsd,COALESCE(sum(actual),0) observedMicroUsd,count(*) requests FROM requests WHERE month=?').get(month),unresolved:db.prepare("SELECT count(*) n FROM requests WHERE state<>'completed'").get().n};},
 close(){db.close();}
 };
}
