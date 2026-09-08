import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {prepareZolaConfigurationInstall,installZolaConfiguration} from '../packages/zola-release/configuration-install.js';

function fixture(){
  const root=fs.mkdtempSync('/root/zola-config-test-'),paths={configDirectory:path.join(root,'etc'),unitDirectory:path.join(root,'systemd'),releaseRoot:path.join(root,'releases')};
  for(const p of Object.values(paths))fs.mkdirSync(p,{mode:0o755});
  const secret=()=>randomBytes(32).toString('base64url'),ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
  const config={version:1,workspace:'blackspire-command',bindingFile:path.join(paths.configDirectory,'buyer-writer-binding.json'),writerCredential:secret(),issuerCredential:secret(),
    runtime:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(),ca},issuer:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(),ca}};
  const input={releaseSha:'a'.repeat(40),configurationFile:path.join(root,'input.json')};fs.writeFileSync(input.configurationFile,JSON.stringify(config),{mode:0o600});
  const calls=[],events=[];let running=false,closed=0;
  const options={paths,uid:0,identity:async()=>({uid:994,credentialGroupId:984,workerUid:993}),
    run:async(file,args)=>{calls.push([file,args]);const user=args.at(-1)==='blackspire-command.service'?'blackspire-api':'blackspire-worker';return {stdout:`ActiveState=${running?'active':'inactive'}\nSubState=${running?'running':'dead'}\nMainPID=${running?'99':'0'}\nUser=${user}\nGroup=blackspire\n`,stderr:''};},
    inspectArtifact:async({releaseSha,environment})=>({releaseSha,environment,artifactDigest:'b'.repeat(64)})};
  const execution={connect:async()=>({isHealthy:()=>true,close:async()=>{closed++;}}),record:event=>events.push(event)};
  return {root,paths,config,input,options,execution,calls,events,closed:()=>closed,start:()=>{running=true;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const rootOnly={skip:process.getuid()!==0};
test('actual protected files publish API-only after scoped checks; rerun preserves exact inodes and contains no secret output',rootOnly,async()=>{
  const f=fixture();try{
    const p=await prepareZolaConfigurationInstall(f.input,f.options);assert.equal(fs.readdirSync(f.paths.configDirectory).length,0);
    const result=await installZolaConfiguration(p,f.execution);assert.equal(result.status,'INSTALLED_RELOAD_REQUIRED');assert.equal(f.closed(),1);
    assert.equal(fs.statSync(p.configPath).mode&0o777,0o640);assert.equal(fs.statSync(p.configPath).gid,984);assert.equal(fs.statSync(p.dropinPath).mode&0o777,0o644);
    assert.deepEqual(JSON.parse(fs.readFileSync(p.configPath)),f.config);assert.match(fs.readFileSync(p.dropinPath,'utf8'),/^\[Service\]\nEnvironment=BUYER_WRITER_MODE=scoped/);
    const ino=fs.statSync(p.configPath).ino,dropino=fs.statSync(p.dropinPath).ino;await installZolaConfiguration(await prepareZolaConfigurationInstall(f.input,f.options),f.execution);
    assert.equal(fs.statSync(p.configPath).ino,ino);assert.equal(fs.statSync(p.dropinPath).ino,dropino);
    for(const v of [f.config.writerCredential,f.config.issuerCredential,f.config.runtime.password,f.config.issuer.password])assert.ok(!JSON.stringify([result,f.events]).includes(v));
    assert.ok(f.calls.every(([file,args])=>file==='/usr/bin/systemctl'&&args[0]==='show'));
  }finally{f.cleanup();}
});
test('failed database authority and durable intent stop all installation, closing clients',rootOnly,async()=>{
  for(const fail of ['database','journal']){const f=fixture();try{
    const p=await prepareZolaConfigurationInstall(f.input,f.options);
    const options=fail==='database'?{...f.execution,connect:async()=>{throw new Error('secret-database-error');}}:{...f.execution,record:()=>{throw new Error('journal unavailable');}};
    await assert.rejects(installZolaConfiguration(p,options),/^Error: Zola configuration installation rejected$/);
    assert.equal(fs.existsSync(p.configPath),false);assert.equal(fs.existsSync(p.dropinPath),false);if(fail==='journal')assert.equal(f.closed(),1);
  }finally{f.cleanup();}}
});
test('actual source replacement, running services, symlink/hardlink and foreign drop-in are refused without overwrite',rootOnly,async()=>{
  for(const change of ['source','running','symlink','hardlink','dropin']){const f=fixture();try{
    const p=await prepareZolaConfigurationInstall(f.input,f.options);
    if(change==='source')fs.writeFileSync(f.input.configurationFile,JSON.stringify({...f.config,writerCredential:randomBytes(32).toString('base64url')}));
    if(change==='running')f.start();
    if(change==='symlink')fs.symlinkSync(f.input.configurationFile,p.configPath);
    if(change==='hardlink')fs.linkSync(f.input.configurationFile,p.configPath);
    if(change==='dropin'){fs.mkdirSync(path.dirname(p.dropinPath));fs.writeFileSync(p.dropinPath,'foreign-settings\n',{mode:0o644});}
    await assert.rejects(installZolaConfiguration(p,f.execution),/^Error: Zola configuration installation rejected$/);
    if(change==='dropin')assert.equal(fs.readFileSync(p.dropinPath,'utf8'),'foreign-settings\n');
    assert.equal(f.events.length,0);
  }finally{f.cleanup();}}
});
test('partial config-only publication is reconciled; inherited ACL and foreign binding/CA are rejected',rootOnly,async()=>{
  const f=fixture();try{
    const p=await prepareZolaConfigurationInstall(f.input,f.options);await installZolaConfiguration(p,f.execution);fs.unlinkSync(p.dropinPath);
    const before=fs.statSync(p.configPath).ino;await installZolaConfiguration(await prepareZolaConfigurationInstall(f.input,f.options),f.execution);assert.equal(fs.statSync(p.configPath).ino,before);
    await assert.rejects(prepareZolaConfigurationInstall(f.input,{...f.options,acl:()=>({status:0,stdout:'user:993:r--\n',stderr:''})}));
    for(const kind of ['binding','ca']){const value=structuredClone(f.config);if(kind==='binding')value.bindingFile='/etc/foreign.json';else value.runtime.ca+='\n';fs.writeFileSync(f.input.configurationFile,JSON.stringify(value));await assert.rejects(prepareZolaConfigurationInstall(f.input,f.options));}
  }finally{f.cleanup();}
});
test('unbranded approval objects cannot reach installation or database connections',async()=>{
  await assert.rejects(installZolaConfiguration({status:'PREPARED'},{connect:()=>assert.fail(),record:()=>assert.fail()}),/^Error: Zola configuration installation rejected$/);
  await assert.rejects(prepareZolaConfigurationInstall({releaseSha:'a'.repeat(40),configurationFile:'/missing'},{uid:123}),/^Error: Zola configuration installation rejected$/);
});

test('inherited named ACL is refused on the empty inode before secrets or relaxed permissions; NSS drift after DB check also refuses',rootOnly,async()=>{
  const f=fixture();try{
    execFileSync('/usr/bin/setfacl',['-m','d:u:993:r--',f.paths.configDirectory]);
    let wrote=0,relaxed=0;
    const io=Object.create(fs);io.writeFileSync=(...args)=>{wrote++;return fs.writeFileSync(...args);};io.fchmodSync=(...args)=>{relaxed++;return fs.fchmodSync(...args);};
    const p=await prepareZolaConfigurationInstall(f.input,{...f.options,io});
    await assert.rejects(installZolaConfiguration(p,f.execution));assert.equal(wrote,0);assert.equal(relaxed,0);assert.equal(fs.existsSync(p.configPath),false);
    execFileSync('/usr/bin/setfacl',['-k',f.paths.configDirectory]);
    let identities=0;
    const q=await prepareZolaConfigurationInstall(f.input,{...f.options,identity:async()=>({uid:994,credentialGroupId:++identities<=2?984:985,workerUid:993})});
    await assert.rejects(installZolaConfiguration(q,f.execution));assert.equal(fs.existsSync(q.configPath),false);
  }finally{f.cleanup();}
});
