import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readOwnedConfigurationBytes as read,publishOwnedConfigurationBytes as publish} from '../packages/zola-release/owned-buyer-configuration-host.js';
const directory=fs.mkdtempSync(path.resolve('.owned-buyer-protected-fixture-'));
fs.chmodSync(directory,0o700);
try{
 const file=path.join(directory,'configuration.json');
 publish(file,null,'before\n');assert.equal(read(file),'before\n');
 publish(file,'before\n','after\n');assert.equal(read(file),'after\n');
 publish(file,'before\n','after\n');assert.throws(()=>publish(file,'foreign\n','replacement\n'));
 const next=path.join(directory,'interrupted.json');fs.writeFileSync(next+'.owned-buyer-stage','retained\n',{mode:0o600});publish(next,null,'retained\n');assert.equal(read(next),'retained\n');
 fs.chmodSync(next,0o644);assert.throws(()=>read(next));fs.chmodSync(next,0o600);
 const link=path.join(directory,'symlink.json');fs.symlinkSync(file,link);assert.throws(()=>read(link));
 const hard=path.join(directory,'hardlink.json');fs.linkSync(file,hard);assert.throws(()=>read(file));fs.unlinkSync(hard);
 const foreign=path.join(directory,'foreign.json');fs.writeFileSync(foreign+'.owned-buyer-stage','foreign\n',{mode:0o600});assert.throws(()=>publish(foreign,null,'expected\n'));assert.equal(fs.existsSync(foreign),false);
 process.stdout.write(JSON.stringify({ok:true,actualProtectedFilesystem:true,atomicReplacement:true,metadataAndLinkDenials:true,productionTouched:false})+'\n');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
