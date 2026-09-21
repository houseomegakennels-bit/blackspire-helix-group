#!/usr/bin/env node
// Generates reviewable non-secret files only. Never executes Docker or SQL.
import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,realpathSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as owned from '../packages/buyer-writer/owned-postgres.js';
const [destination,...extra]=process.argv.slice(2);
if(process.versions.node!=='22.23.1'||extra.length||!destination||!path.isAbsolute(destination)||path.resolve(destination)!==destination)throw new Error('Absolute new preparation directory required');
const parent=path.dirname(destination);
if(realpathSync(parent)!==parent||!lstatSync(parent).isDirectory())throw new Error('Canonical preparation parent required');
mkdirSync(destination,{mode:0o700});
const files={
 'bootstrap.sql':owned.OWNED_POSTGRES_BOOTSTRAP_SQL,
 'template1.sql':owned.OWNED_POSTGRES_TEMPLATE_SQL,
 'postgresql.conf':owned.OWNED_POSTGRES_CONFIGURATION,
 'pg_hba.conf':owned.OWNED_POSTGRES_HBA,
 'pg_ident.conf':owned.OWNED_POSTGRES_IDENT,
 'blackspire-owned-postgres.service':owned.OWNED_POSTGRES_SERVICE,
 'container-arguments.json':JSON.stringify(owned.ownedPostgresContainerArguments(),null,2)+'\n',
};
const source=readFileSync(new URL('../packages/buyer-writer/owned-postgres.js',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest={version:1,status:'PREPARED_ONLY',target:owned.OWNED_POSTGRES_TARGET,sourceSha256:hash(source),files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{sha256:hash(bytes),bytes:Buffer.byteLength(bytes)}]))};
files['manifest.json']=JSON.stringify(manifest,null,2)+'\n';
for(const [name,bytes] of Object.entries(files)){const fd=openSync(path.join(destination,name),'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
for(const directory of [destination,parent]){const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
process.stdout.write(JSON.stringify({status:'PREPARED_ONLY',files:Object.keys(files).length,manifestSha256:hash(files['manifest.json']),executionPerformed:false})+'\n');
