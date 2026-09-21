import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ownedPostgresContainerArguments,OWNED_POSTGRES_TARGET,OWNED_POSTGRES_DATA_PATH} from '../packages/buyer-writer/owned-postgres.js';
import {validateOwnedContainerMetadata} from '../packages/buyer-writer/owned-postgres-materializer.js';
assert.equal(process.versions.node,'22.23.1');
const operationId=randomUUID(),name='zola-metadata-'+operationId,root=mkdtempSync(path.join(os.tmpdir(),'zola-owned-metadata-'));let id;
const run=args=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});assert.equal(r.status,0,(r.stderr??'').slice(0,400));return r.stdout.trim();};
try{
 mkdirSync(root+'/data');mkdirSync(root+'/server');
 const args=[...ownedPostgresContainerArguments()];args[args.indexOf('--name')+1]=name;args[args.indexOf('--network')+1]='none';args.splice(1,0,'--label','blackspire.materialization='+operationId);
 for(let i=0;i<args.length;i++)args[i]=args[i].replace(OWNED_POSTGRES_DATA_PATH,root+'/data').replace('/etc/blackspire/owned-postgres/server',root+'/server');
 id=run(args);const observed=JSON.parse(run(['inspect',id]))[0],image=JSON.parse(run(['image','inspect',OWNED_POSTGRES_TARGET.image]))[0];
 assert.equal(observed.Config.Labels['blackspire.materialization'],operationId);
 // Only substitute the two explicitly owned disposable bind paths; all actual
 // Docker mount kinds/options/network metadata reach the production validator.
 const fixture=structuredClone(observed);for(const mount of fixture.Mounts){if(mount.Source===root+'/data')mount.Source=OWNED_POSTGRES_DATA_PATH;if(mount.Source===root+'/server')mount.Source='/etc/blackspire/owned-postgres/server';}
 const context={imageId:image.Id,imageConfig:image.Config,operationId,bootstrap:true};
 assert.equal(validateOwnedContainerMetadata(fixture,context).id,id);
 for(const mutate of [c=>c.Mounts.push({Type:'volume',Source:'foreign',Destination:'/extra',RW:true}),c=>{c.HostConfig.Tmpfs['/extra']='rw';},c=>{c.NetworkSettings.Networks.bridge={};},c=>{c.HostConfig.SecurityOpt.push('seccomp=unconfined');},c=>{c.Config.Cmd=['sh'];}]){const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>validateOwnedContainerMetadata(bad,context));}
 console.log(JSON.stringify({ok:true,actualDockerMetadata:true,extraMountNetworkAndCommandDenied:true,productionTouched:false}));
}finally{if(id){const actual=JSON.parse(run(['inspect',id]))[0];assert.equal(actual.Config.Labels['blackspire.materialization'],operationId);run(['rm','-f',id]);}rmSync(root,{recursive:true,force:true});}
