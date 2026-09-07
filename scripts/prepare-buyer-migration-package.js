import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';
import {prepareBuyerMigrationPackage} from '../packages/buyer-writer/migration-package.js';
try {
 if(process.versions.node!=='22.23.1'||process.getuid?.()!==0||process.argv.length!==4)throw new Error();
 const [configuration,output]=process.argv.slice(2);
 const input=readRootOwnedJsonSnapshot(configuration,{groupId:0});
 if(Object.keys(input.value).sort().join(',')!=='providerManifest,releaseSha')throw new Error();
 const root=fileURLToPath(new URL('..',import.meta.url));
 const gitArgs=['--no-replace-objects','-c','core.useReplaceRefs=false','-C',root];
 const gitOptions={encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}};
 const head=execFileSync('/usr/bin/git',[...gitArgs,'rev-parse','HEAD'],gitOptions).trim();
 if(head!==input.value.releaseSha)throw new Error();
 execFileSync('/usr/bin/git',[...gitArgs,'diff','--no-ext-diff','--no-textconv','--exit-code','HEAD','--','packages/buyer-writer','scripts/prepare-buyer-migration-package.js','frontend/supabase/migrations'],{...gitOptions,stdio:'pipe'});
 const untracked=execFileSync('/usr/bin/git',[...gitArgs,'ls-files','--others','--exclude-standard','--','packages/buyer-writer','scripts/prepare-buyer-migration-package.js','frontend/supabase/migrations'],gitOptions);
 if(untracked.trim())throw new Error();
 const prepared=prepareBuyerMigrationPackage(input.value);
 if(!path.isAbsolute(output)||path.resolve(output)!==output||output==='/')throw new Error();
 for(let p=path.dirname(output);;p=path.dirname(p)){
  const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw new Error();if(p==='/')break;
 }
 fs.mkdirSync(output,{mode:0o700});
 const write=(name,bytes)=>fs.writeFileSync(path.join(output,name),bytes,{mode:0o600,flag:fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW});
 write('application.sql',prepared.sql);write('application-body.sql',prepared.body);write('manifest.json',prepared.manifestBytes);
 console.log(JSON.stringify({status:prepared.manifest.status,manifestSha256:createHash('sha256').update(prepared.manifestBytes).digest('hex'),sqlSha256:prepared.manifest.sqlSha256,productionApplied:false}));
}catch{console.error('Buyer migration package rejected');process.exitCode=1;}
