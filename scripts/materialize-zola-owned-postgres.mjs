#!/usr/bin/env node
import {materializeOwnedPostgres} from '../packages/buyer-writer/owned-postgres-materializer.js';
try{
 const [flag,releaseSha,...rest]=process.argv.slice(2);
 if(flag!=='--release-sha'||rest.length||!(/^[a-f0-9]{40}$/).test(releaseSha??''))throw new Error('arguments');
 const result=await materializeOwnedPostgres({releaseSha});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Owned PostgreSQL materialization blocked; protected evidence retained, no credentials disclosed\n');process.exitCode=1;}
