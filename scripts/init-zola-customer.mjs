#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Preparation only: deliberately neither reads process.env nor starts existing runtimes.
export function initializeCustomer({directory,origin,provider='none'}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('Absolute destination required.');
  if (!['none','openai','anthropic'].includes(provider)) throw Error('Unsupported AI provider.');
  let url;
  try { url = new URL(origin); } catch { throw Error('Valid HTTPS origin required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('Bare HTTPS origin required.');
  if (url.hostname === 'blackspirehelix.com' || url.hostname.endsWith('.blackspirehelix.com'))
    throw Error('Customer-owned hostname required.');
  const target = path.resolve(directory);
  // Resolve an existing parent; do not follow a destination symlink or reuse a directory.
  const parent = fs.realpathSync(path.dirname(target));
  const destination = path.join(parent,path.basename(target));
  fs.mkdirSync(destination,{mode:0o700});
  try {
    for (const name of ['data','secrets','backups']) fs.mkdirSync(path.join(destination,name),{mode:0o700});
    const manifest = {
      schemaVersion:1,installationId:randomUUID(),origin:url.origin,
      status:'prepared_not_runnable',credentialSource:'installation_only',
      fallbackCredentials:false,
      ai:{provider,connectionStatus:provider==='none'?'skipped':'needs_credentials',fallbackProvider:null},
      modules:{core:{enabled:true},cloudAi:{enabled:false},voice:{enabled:false},
        telegram:{enabled:false},social:{enabled:false}},
      budget:{automaticRefill:false,monthlyLimitUsd:null},
      releaseBlockers:['customer-api-worker','runtime-configuration-adapter','https-and-services',
        'backup-restore-verification','spend-enforcement','clean-host-acceptance']
    };
    fs.writeFileSync(path.join(destination,'installation.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(destination,'secrets','providers.json'),JSON.stringify({
      schemaVersion:1,installationId:manifest.installationId,providers:{}
    },null,2)+'\n',{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(destination,'README.txt'),
      'Zola customer setup prepared; no services installed or started.\n'+
      'No credentials were imported. Optional integrations are disabled.\n'+
      'Do not point the existing Blackspire runtime at this directory.\n'+
      'Configuration adapters and acceptance checks are required before launch.\n',
      {flag:'wx',mode:0o600});
    return {status:manifest.status,installationId:manifest.installationId,directory:destination};
  } catch(error) {
    // Leave partial preparation for inspection; never delete or reuse it automatically.
    throw Error('Customer setup incomplete; inspect destination before retry.',{cause:error});
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if(args.length !== 6 || args[0] !== '--directory' || args[2] !== '--origin' || args[4] !== '--provider') {
    console.error('Usage: node scripts/init-zola-customer.mjs --directory /new/customer-dir --origin https://customer.example --provider openai|anthropic|none');
    process.exitCode=1;
  } else {
    try { console.log(JSON.stringify(initializeCustomer({directory:args[1],origin:args[3],provider:args[5]}))); }
    catch { console.error('Setup refused or incomplete. Check HTTPS origin and use a new directory under an existing private parent.'); process.exitCode=1; }
  }
}
