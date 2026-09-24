import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installRuntimeDependencies} from '../scripts/install-runtime-dependencies.js';
import {computeArtifactDigest} from '../packages/shared/release-evidence.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-install-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pkg={name:'isolated',version:'1.0.0',dependencies:{pg:'8.23.0'}};
  const lock={lockfileVersion:3,packages:{'':{dependencies:pkg.dependencies},'node_modules/pg':{version:'8.23.0',resolved:'https://registry.npmjs.org/pg/-/pg-8.23.0.tgz',integrity:'sha512-c3ludGhldGlj'}}};
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock));
  return {root,lock};
}
function fakeInstall(_node,args,options){
  assert.ok(args.includes('ci'));assert.ok(args.includes('--ignore-scripts'));assert.ok(args.includes('--no-bin-links'));
  assert.ok(args.includes('--workspaces=false'));assert.equal(args[args.indexOf('--prefix')+1],options.cwd);
  assert.equal(options.timeout,120000);assert.equal(options.env.PGPASSWORD,undefined);assert.equal(options.env.NPM_TOKEN,undefined);
  assert.notEqual(options.env.HOME,process.env.HOME);
  assert.equal(fs.readFileSync(options.env.NPM_CONFIG_USERCONFIG,'utf8'),'');
  const pkg=path.join(options.cwd,'node_modules/pg');fs.mkdirSync(pkg,{recursive:true});
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'pg',version:'8.23.0'}));
  fs.writeFileSync(path.join(pkg,'index.js'),'export const synthetic=true;\n');
  return {status:0};
}
test('fresh deterministic installation excludes ambient credentials and remains inside artifact digest',t=>{
  const {root}=fixture(t);const result=installRuntimeDependencies(root,{run:fakeInstall});assert.equal(result.installed,true);
  const before=computeArtifactDigest(root);fs.appendFileSync(path.join(root,'node_modules/pg/index.js'),'// altered\n');
  assert.notEqual(computeArtifactDigest(root),before);
});
test('sealed artifacts, npm configuration, existing dependencies and linked manifests are never changed',t=>{
  for(const marker of ['RELEASE_EVIDENCE.json','.release-complete','.deployment-record.json','.npmrc','node_modules']) {
    const {root}=fixture(t);fs.writeFileSync(path.join(root,marker),'preserved');
    assert.throws(()=>installRuntimeDependencies(root,{run:()=>assert.fail('must not install')}),/rejected/);
    assert.equal(fs.readFileSync(path.join(root,marker),'utf8'),'preserved');
  }
  const {root}=fixture(t);fs.renameSync(path.join(root,'package.json'),path.join(root,'saved.json'));
  fs.symlinkSync('saved.json',path.join(root,'package.json'));
  assert.throws(()=>installRuntimeDependencies(root,{run:()=>assert.fail('must not install')}),/rejected/);
});
test('untrusted registry URLs and install-time lock mutation fail closed',t=>{
  const {root,lock}=fixture(t);lock.packages['node_modules/pg'].resolved='https://untrusted.invalid/pg.tgz';
  fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock));
  assert.throws(()=>installRuntimeDependencies(root,{run:()=>assert.fail('must not install')}),/rejected/);
  const fresh=fixture(t);
  assert.throws(()=>installRuntimeDependencies(fresh.root,{run:(...args)=>{
    const result=fakeInstall(...args);fs.appendFileSync(path.join(fresh.root,'package-lock.json'),' ');return result;
  }}),/rejected/);
});
test('workspace declarations cannot redirect dependency installation',t=>{
  const {root}=fixture(t);const file=path.join(root,'package.json');const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
  pkg.workspaces=['../unrelated'];fs.writeFileSync(file,JSON.stringify(pkg));
  assert.throws(()=>installRuntimeDependencies(root,{run:()=>assert.fail('must not install')}),/rejected/);
});
