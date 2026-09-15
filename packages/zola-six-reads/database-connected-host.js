import https from 'node:https';
import { readRootOwnedJson } from '../buyer-writer/protected-json.js';
import { refuse } from './collector.js';
import { createJournaledConnectedObserver, CONNECTED_OBSERVER_ENDPOINT } from './database-connected.js';

// Official contract: /docs/reference/api/v1-run-a-query, verified 2026-09-08.
// The /read-only endpoint uses supabase_read_only_user and cannot establish this
// observer's postgres bypass-RLS and SET ROLE authenticated witness contract.
// No ambient token, MCP JSON import, alternate endpoint, SQL input or TLS bypass.
export function createProductionConnectedDatabaseObserver(config) {
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
