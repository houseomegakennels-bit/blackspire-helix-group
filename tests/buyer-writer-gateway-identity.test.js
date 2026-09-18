import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderGatewayUnit} from '../packages/buyer-writer/gateway-installation.js';
import {BUYER_WRITER_GATEWAY_CONFIG} from '../packages/zola-release/pg-net-host-observer.js';

const rootOnly={skip:process.getuid?.()!==0};
const NODE='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';

test('writer sysusers contract creates a private system identity without login, home, or broad membership',()=>{
  const source=fs.readFileSync('ops/runtime-ownership/blackspire-buyer-writer-gateway.sysusers.conf','utf8');
  const records=source.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  assert.deepEqual(records,['u blackspire-writer - "Blackspire Buyer Writer gateway" /nonexistent /usr/sbin/nologin']);
  assert.doesNotMatch(source,/^m\s|\bblackspire-writer\s+blackspire\b/m);
});

test('gateway service is immutable, hardened, and excludes the broad application group',()=>{
  const unit=fs.readFileSync('ops/runtime-ownership/blackspire-buyer-writer-gateway.service','utf8');
  assert.match(unit,/^User=blackspire-writer$/m);
  assert.match(unit,/^Group=blackspire-api$/m);
  assert.match(unit,/^SupplementaryGroups=blackspire-writer$/m);
  assert.doesNotMatch(unit,/^(?:Group|SupplementaryGroups)=.*(?:^|\s)blackspire(?:\s|$)/m);
  assert.match(unit,/^WorkingDirectory=\/opt\/blackspire-command\/releases\/@BLACKSPIRE_GATEWAY_RELEASE_SHA@$/m);
  const rendered=renderGatewayUnit(unit,{sha:'a'.repeat(40)});
  const configuredPath=/^Environment=BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG=(.*)$/m.exec(rendered);
  assert.equal(configuredPath?.[1],BUYER_WRITER_GATEWAY_CONFIG);
  assert.equal([...rendered.matchAll(/\/opt\/blackspire-command\/releases\/([a-f0-9]{40})(?=\/|\r?$)/gm)].length,4);
  assert.match(unit,/^ExecStartPre=\+.*\/releases\/@BLACKSPIRE_GATEWAY_RELEASE_SHA@\/packages\/buyer-writer\/gateway-socket-cleanup\.js$/m);
  assert.match(unit,/^ExecStart=.*\/releases\/@BLACKSPIRE_GATEWAY_RELEASE_SHA@\/packages\/buyer-writer\/gateway-entry\.js --configuration @BLACKSPIRE_GATEWAY_CONFIG_PATH@$/m);
  assert.match(unit,/^ExecStartPost=.*\/releases\/@BLACKSPIRE_GATEWAY_RELEASE_SHA@\/packages\/buyer-writer\/gateway-readiness\.js --configuration @BLACKSPIRE_GATEWAY_CONFIG_PATH@$/m);
  assert.doesNotMatch(unit,/\/current(?:\/|$)|\/HEAD(?:\/|$)|\/opt\/blackspire\/\.worktrees/);
  for(const directive of ['NoNewPrivileges=yes','PrivateTmp=yes','PrivateDevices=yes','ProtectSystem=strict','ProtectHome=yes',
    'ProtectKernelTunables=yes','ProtectKernelModules=yes','ProtectKernelLogs=yes','ProtectControlGroups=yes','ProtectClock=yes',
    'ProtectHostname=yes','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','RestrictSUIDSGID=yes','RestrictNamespaces=yes',
    'SystemCallArchitectures=native','CapabilityBoundingSet=','AmbientCapabilities='])assert.match(unit,new RegExp(`^${directive.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m'));
});

test('dedicated secret hierarchy grants only the writer traversal/read model',rootOnly,()=>{
  assert.equal(fs.existsSync(NODE),true,'reviewed Node runtime is required for dropped-identity permission proof');
  const tmpfiles=fs.readFileSync('ops/runtime-ownership/blackspire-buyer-writer-gateway.tmpfiles.conf','utf8');
  assert.match(tmpfiles,/^d \/etc\/blackspire-buyer-writer-gateway 0750 root blackspire-writer -$/m);
  assert.match(tmpfiles,/^d \/run\/blackspire 0750 blackspire-writer blackspire-api -$/m);
  assert.doesNotMatch(tmpfiles,/^d \/etc\/blackspire\/buyer-writer-gateway/m);

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-writer-permissions-'));
  const writer={uid:61001,gid:61001},api={uid:61002,gid:61002},worker={uid:61003,gid:61003};
  try{
    fs.chmodSync(root,0o755);
    const directory=path.join(root,'gateway');fs.mkdirSync(directory,{mode:0o750});fs.chownSync(directory,0,writer.gid);
    const secret=path.join(directory,'gateway.json');fs.writeFileSync(secret,'fixture-only\n',{mode:0o640});fs.chownSync(secret,0,writer.gid);
    const probe=identity=>spawnSync(NODE,['-e','require("node:fs").accessSync(process.argv[1],require("node:fs").constants.R_OK)',secret],
      {uid:identity.uid,gid:identity.gid,encoding:'utf8'});
    const writerRead=probe(writer),apiRead=probe(api),workerRead=probe(worker);
    assert.equal(writerRead.status,0,'writer private group must read its root-owned configuration');
    assert.notEqual(apiRead.status,0,'API identity must not traverse/read gateway secrets');
    assert.notEqual(workerRead.status,0,'worker identity must not traverse/read gateway secrets');
    assert.equal(apiRead.stdout,'');assert.equal(workerRead.stdout,'');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
