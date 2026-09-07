import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBuyerWriterExecutable,SUPERVISOR_CONTRACT_SHA256} from '../packages/buyer-writer/executable.js';
function fixture(){
  const root='/opt/blackspire/releases/'+'a'.repeat(40),node='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';
  const links={exe:node,cwd:root};let argv=[node,'scripts/production-supervisor.js','--worker-only'];
  const options={pid:222,role:'worker',kind:'supervisor',artifactRoot:root,uid:0,
    readLink:name=>links[name.split('/').at(-1)],readCommand:()=>Buffer.from(argv.join('\0')+'\0'),
    readEnvironment:()=>Buffer.from('NODE_ENV=production\0'),
    inspectFile:(filename,hash)=>({dev:1,ino:filename===node?2:3,sha256:hash?SUPERVISOR_CONTRACT_SHA256:null}),
  };
  return{options,links,node,root,setArgs:value=>{argv=value;}};
}
test('capture pins the supervised executable, release directory, role arguments and reviewed no-respawn contract',()=>{
  const f=fixture(),result=captureBuyerWriterExecutable(f.options);
  assert.equal(result.scriptSha256,SUPERVISOR_CONTRACT_SHA256);assert.equal(result.nodeInode,2);
  assert.equal(Object.hasOwn(result,'commandLine'),false);
});
test('wrong binary, release directory, role, source contract or caller identity is rejected',()=>{
  for(const mutate of [f=>{f.links.exe='/other/node';},f=>{f.links.cwd='/other/release';},f=>{f.options.uid=994;},
    f=>{f.setArgs([f.node,'scripts/production-supervisor.js','--api-only']);},f=>{f.setArgs([f.node,'scripts/production-supervisor.js','--worker-only','extra']);},
    f=>{f.setArgs([f.node,'other/../scripts/production-supervisor.js','--worker-only']);},
    f=>{f.options.inspectFile=()=>({dev:1,ino:2,sha256:'d'.repeat(64)});},f=>{f.options.artifactRoot='/opt/../other';},
  ]){const f=fixture();mutate(f);assert.throws(()=>captureBuyerWriterExecutable(f.options),error=>error.message==='Buyer writer executable identity rejected'&&!error.cause);}
});
test('child executable must be the exact role entrypoint with no extra arguments',()=>{
  const f=fixture();f.options.kind='child';f.setArgs([f.node,'apps/worker/worker.js']);
  assert.match(captureBuyerWriterExecutable(f.options).scriptSha256,/^[a-f0-9]{64}$/);
  f.setArgs([f.node,'apps/api/server.js']);assert.throws(()=>captureBuyerWriterExecutable(f.options));
});
test('process command or file replacement during capture rejects without leaking raw input',()=>{
  const f=fixture();let reads=0;
  f.options.readCommand=()=>Buffer.from([f.node,'scripts/production-supervisor.js',++reads===1?'--worker-only':'PRIVATE'].join('\0')+'\0');
  assert.throws(()=>captureBuyerWriterExecutable(f.options),error=>error.message==='Buyer writer executable identity rejected'&&!error.cause);
});
test('environment loader, crypto and TLS overrides cannot authorize an otherwise matching executable',()=>{
  for(const key of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH','LD_AUDIT','OPENSSL_CONF','OPENSSL_CONF_INCLUDE','OPENSSL_MODULES','OPENSSL_ENGINES','NODE_EXTRA_CA_CERTS','SSLKEYLOGFILE','NODE_TLS_REJECT_UNAUTHORIZED']){
    const f=fixture();f.options.readEnvironment=()=>Buffer.from(`NODE_ENV=production\0${key}=PRIVATE\0`);
    assert.throws(()=>captureBuyerWriterExecutable(f.options),error=>error.message==='Buyer writer executable identity rejected'&&!error.cause);
  }
});
test('malformed, duplicate, oversized or changing environment observations fail without exposing values',()=>{
  for(const bytes of [Buffer.from('NODE_ENV=production'),Buffer.from('NODE_OPTIONS=\0NODE_OPTIONS=\0'),Buffer.alloc(131073),Buffer.from([255,0])]){
    const f=fixture();f.options.readEnvironment=()=>bytes;assert.throws(()=>captureBuyerWriterExecutable(f.options));
  }
  const f=fixture();let reads=0;f.options.readEnvironment=()=>Buffer.from(`NODE_ENV=production\0PRIVATE=${++reads}\0`);
  assert.throws(()=>captureBuyerWriterExecutable(f.options),error=>error.message==='Buyer writer executable identity rejected'&&!error.cause);
});
