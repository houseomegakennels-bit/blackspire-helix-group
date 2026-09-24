import fs from 'node:fs';
import pg from 'pg';
import {readOwnedDatabaseProfile,databaseProfileDigest,validateManagementCredential,verifyOwnedDatabaseIdentity,databaseTlsOptions,OWNED_DATABASE_MANAGEMENT} from '../buyer-writer/database-profile.js';
import {createJournaledOwnedObserver} from './owned-database-observer.js';
import {createFixedNativeObserverClient} from './database-host.js';
import {queryObservation} from './database-observer.js';
import https from 'node:https';
import { readRootOwnedJson } from '../buyer-writer/protected-json.js';
import { refuse } from './collector.js';
import { createJournaledConnectedObserver, CONNECTED_OBSERVER_ENDPOINT } from './database-connected.js';

// Official contract: /docs/reference/api/v1-run-a-query, verified 2026-09-08.
// The /read-only endpoint uses supabase_read_only_user and cannot establish this
// observer's postgres bypass-RLS and SET ROLE authenticated witness contract.
// No ambient token, MCP JSON import, alternate endpoint, SQL input or TLS bypass.
export function createProductionConnectedDatabaseObserver(config) {
  if([6,7].includes(config.version))return createJournaledOwnedObserver(config,async({source,sql})=>{
    let client;
    try{
      const profile=readOwnedDatabaseProfile();
      if(databaseProfileDigest(profile)!==config.profileDigest||config.backendProfile!=='owned-postgres-v1'||config.ownedObserverDatabaseConfigPath!==OWNED_DATABASE_MANAGEMENT||config.observerDatabaseConfigPath!=='/etc/blackspire-buyer-writer-gateway/management.json')refuse('OWNED_OBSERVER_PROFILE');
      const targetPath='/var/lib/blackspire-operator/owned-writer-acceptance.json',target=readRootOwnedJson(targetPath,{groupId:fs.lstatSync(targetPath).gid,maxBytes:16384});
      if(target.kind!=='zola_owned_bounded_writer_acceptance_target'||target.backendProfile!==config.backendProfile||target.profileDigest!==config.profileDigest||target.jobId!==config.acceptanceSearchJobId||target.releaseSha!==config.releaseSha||target.workspace!==config.workspace)refuse('OWNED_OBSERVER_TARGET');
      if(source==='source')client=createFixedNativeObserverClient(config);
      else if(source==='owned'){
        const credential=validateManagementCredential(readRootOwnedJson(OWNED_DATABASE_MANAGEMENT,{groupId:0,maxBytes:65536}),{ownedProfile:profile});
        client=new pg.Client({...credential,ca:undefined,ssl:databaseTlsOptions(credential),connectionTimeoutMillis:5000,query_timeout:20000,application_name:'zola-owned-six-read-observer',options:'-c default_transaction_read_only=on'});
      }else refuse('OWNED_OBSERVER_SOURCE');
      client.on('error',()=>{});await client.connect();if(source==='owned')await verifyOwnedDatabaseIdentity(client,profile);
      const value=await queryObservation(client,sql);
      const again=readRootOwnedJson(targetPath,{groupId:fs.lstatSync(targetPath).gid,maxBytes:16384});
      if(JSON.stringify(again)!==JSON.stringify(target)||(value.jobId!==undefined&&(value.jobId!==target.jobId||value.ownerId!==target.ownerId)))refuse('OWNED_OBSERVER_TARGET_CHANGED');
      if(Buffer.byteLength(JSON.stringify(value))>65536||databaseProfileDigest(readOwnedDatabaseProfile())!==config.profileDigest)refuse('OWNED_OBSERVER_BOUND');
      return value;
    }catch{refuse('OWNED_OBSERVER_FAILED');}finally{if(client)await client.end().catch(()=>{});}
  });
  if ([4,5].includes(config.version)) return createJournaledConnectedObserver(config, async query => {
    let client;
    try {
      client=createFixedNativeObserverClient(config);
      client.on('error',()=>{});
      await client.connect();
      // The exact journaled SQL supplies the repeatable-read, read-only transaction,
      // statement/lock limits, postgres snapshot and authenticated owner witness.
      const value=await queryObservation(client,query);
      if(Buffer.byteLength(JSON.stringify(value))>65536)refuse('CONNECTED_OBSERVER_BOUND');
      return value;
    } catch { refuse('CONNECTED_OBSERVER_FAILED'); }
    finally { if(client)await client.end().catch(()=>{}); }
  });
  return createJournaledConnectedObserver(config, async query => {
    let credential;
    try {
      credential = readRootOwnedJson(config.observerDatabaseConfigPath,{groupId:0,maxBytes:16384});
      if (Object.keys(credential).sort().join(',')!=='accessToken,projectId' || credential.projectId!=='kchtrvfcixnimvxxctkj' ||
        typeof credential.accessToken!=='string' || credential.accessToken.length<24 || credential.accessToken.length>4096 || !/^[A-Za-z0-9._~-]+$/.test(credential.accessToken)) refuse('CONNECTED_OBSERVER_CREDENTIAL');
      const body = JSON.stringify({query,read_only:true});
      return await new Promise((resolve,reject)=>{
        let settled=false;
        const fail=()=>{if(!settled){settled=true;reject(new Error('CONNECTED_OBSERVER_HTTP'));}};
        const request = https.request(CONNECTED_OBSERVER_ENDPOINT,{method:'POST',agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',
          headers:{authorization:`Bearer ${credential.accessToken}`,'content-type':'application/json','content-length':Buffer.byteLength(body),accept:'application/json'},
          signal:AbortSignal.timeout(25000)},response=>{
          // Node https performs no redirects; never forward authorization.
          if(response.statusCode!==201 || !/^application\/json(?:;|$)/i.test(response.headers['content-type']??'')){response.destroy();fail();return;}
          const chunks=[];let bytes=0;
          response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){response.destroy();fail();}else chunks.push(chunk);});
          response.on('error',fail);response.on('aborted',fail);
          response.on('end',()=>{
            if(settled)return;
            try {
              const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if(!Array.isArray(rows)||rows.length!==1||!rows[0]||Object.keys(rows[0]).join(',')!=='observation')throw new Error();
              settled=true;resolve(rows[0].observation);
            }catch{fail();}
          });
        });
        request.on('error',fail);
        request.end(body);
      });
    } catch { refuse('CONNECTED_OBSERVER_FAILED'); }
  });
}
