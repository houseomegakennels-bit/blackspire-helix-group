#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import {authenticateBuyerWriterProductionIdentity,provisionBuyerWriterProduction} from '../packages/buyer-writer/production-provisioner.js';

const stopped=()=>{throw new Error('Buyer writer production provisioner stopped');};
const args=process.argv.slice(2);

try{
  if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||args.length!==3
    ||!['--inspect','--apply','--reconcile','--verify','--rollback'].includes(args[0])
    ||args[1]!=='--management-config'||!path.isAbsolute(args[2])||path.resolve(args[2])!==args[2]||args[2]==='/')stopped();
  const lookupWriterGroup=()=>execFileSync('/usr/bin/getent',['group','blackspire-writer'],{
    encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],
    env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'},
  });
  const connect=async credential=>{
    const client=new pg.Client({host:credential.host,port:5432,database:'postgres',user:'postgres',password:credential.password,
      ssl:{rejectUnauthorized:true,ca:credential.ca},application_name:'blackspire-buyer-writer-production-provisioner',
      connectionTimeoutMillis:5000,query_timeout:45000,
      options:'-c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000 -c search_path=pg_catalog'});
    client.on('error',()=>{});
    await client.connect();
    return client;
  };
  const authenticate=(kind,credential,creatorOid)=>authenticateBuyerWriterProductionIdentity({kind,credential,creatorOid,Client:pg.Client});
  const result=await provisionBuyerWriterProduction({mode:args[0].slice(2),managementConfigPath:args[2],lookupWriterGroup,connect,authenticate});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}catch{
  process.stderr.write('Buyer writer production provisioner stopped; protected inputs and database state were not disclosed\n');
  process.exitCode=1;
}
