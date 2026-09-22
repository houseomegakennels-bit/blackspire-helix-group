import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// Execute the actual launcher in an isolated VM: every imported dependency is
// a synthetic module, and the context has no host process, filesystem or network.
// A fresh subprocess enables VM modules without requiring repository test flags.
const harness=String.raw`
import vm from 'node:vm';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const sourceUrl=new URL('./scripts/zola-release-owned-successor-operator.js',import.meta.url);
const source=fs.readFileSync(sourceUrl,'utf8');
const mode=process.argv[1],releaseSha='a8e05ef40e44b6695df5b30356af0e411fe36f1a';
const events=[],output=[];
const fakeProcess={getuid:()=>0,versions:{node:'22.23.1'},argv:['node',fileURLToPath(sourceUrl),mode,'/var/lib/blackspire-operator/preparation/owned-successor-final-'+releaseSha+'/production-release.json'],stdout:{write:s=>output.push(s)},exitCode:0};
const context=vm.createContext({process:fakeProcess,URL});
const make=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});
const modules={
 'node:module':make({register:url=>events.push(['register',url.pathname])}),
 'node:child_process':make({execFileSync:(file,args)=>{events.push(['git',file,args]);if(file!=='/usr/bin/git')throw Error('Unexpected executable');return '';}}),
 'node:url':make({fileURLToPath}),
 '../packages/zola-release/owned-sequence-overlay.js':make({OWNED_SEQUENCE:{releaseSha}})
};
const launcher=new vm.SourceTextModule(source,{context,identifier:sourceUrl.href,initializeImportMeta:meta=>{meta.url=sourceUrl.href;},importModuleDynamically:async specifier=>{
 let module;
 if(specifier==='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921/packages/zola-release/commander-host.js')module=make({verifyReleaseSource:sha=>events.push(['verify',sha])});
 else if(specifier==='./zola-release-owned-n8n-operator.js')module=new vm.SyntheticModule([],function(){events.push(['inner',fakeProcess.argv[2]]);},{context});
 else throw Error('Unexpected dynamic import');
 await module.link(()=>{throw Error('Unexpected nested import');});await module.evaluate();return module;
}});
await launcher.link(specifier=>{if(!modules[specifier])throw Error('Unexpected static import');return modules[specifier];});
await launcher.evaluate();
process.stdout.write(JSON.stringify({events,output,exitCode:fakeProcess.exitCode}));
`;
function execute(mode){
 const child=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',harness,'--',mode],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',NODE_NO_WARNINGS:'1'}});
 assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);
}
for(const mode of ['--release-cloud-proof-attempt5','--release-cloud-proof-attempt6','--release-cloud-proof-attempt7'])test(`actual successor launcher dispatches ${mode} only after source gates`,()=>{
 const result=execute(mode);assert.equal(result.exitCode,0);assert.deepEqual(result.output,[]);
 assert.deepEqual(result.events.map(e=>e[0]),['git','git','verify','register','inner']);
 assert.deepEqual(result.events.at(-1),['inner',mode]);
 assert.ok(result.events[0][2].includes('--porcelain'));assert.ok(result.events[1][2].includes('--is-ancestor'));
 assert.match(result.events[3][1],/\/packages\/zola-release\/owned-sequence-loader\.js$/);
});
test('actual successor launcher rejects unknown mode before git or dynamic dispatch',()=>{
 const result=execute('--release-cloud-proof-attempt8');assert.equal(result.exitCode,1);assert.deepEqual(result.events,[]);
 assert.deepEqual(JSON.parse(result.output.join('')),{status:'STOPPED',reason:'OWNED_SUCCESSOR_OPERATOR_REJECTED',releaseReady:false});
});
