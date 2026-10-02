#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const CUSTOMER_FILES=[
 'scripts/init-zola-customer.mjs','scripts/customer-status.mjs','scripts/customer-ai.mjs','scripts/configure-customer-ai.mjs',
 'packages/shared/customer-installation.js','packages/customer/private-files.mjs','packages/customer/vault.mjs','packages/customer/policy.mjs','packages/customer/ledger.mjs','packages/customer/runtime.mjs',
 'packages/customer/recovery-review.mjs','packages/customer/backup.mjs','scripts/customer-backup.mjs',
 'packages/customer/onboarding.mjs','scripts/customer-onboarding.mjs',
 'docs/ZOLA_CUSTOMER_CLI.md'
];
export function packageCustomer(sourceRoot,destination){
 if(!path.isAbsolute(destination))throw Error('ABSOLUTE_DESTINATION_REQUIRED');
 const source=fs.realpathSync(sourceRoot),out=path.resolve(destination);
 if(out===source||out.startsWith(source+path.sep))throw Error('OUTPUT_MUST_BE_OUTSIDE_SOURCE');
 // Read and validate only the fixed distributable allowlist. Never scan/copy the repository broadly.
 const entries=CUSTOMER_FILES.map(relative=>{const file=path.join(source,relative);if(fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())throw Error('UNSAFE_SOURCE_FILE');const data=fs.readFileSync(file);if(data.length>131072)throw Error('SOURCE_TOO_LARGE');return {relative,data};});
 fs.mkdirSync(out,{mode:0o700});
 for(const {relative,data} of entries){const dest=path.join(out,relative);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,data,{flag:'wx',mode:0o600});}
 const packageBytes=Buffer.from(JSON.stringify({name:'zola-customer-text-preview',private:true,type:'module',engines:{node:'22.23.1'}})+'\n');
 fs.writeFileSync(path.join(out,'package.json'),packageBytes,{flag:'wx',mode:0o600});
 entries.push({relative:'package.json',data:packageBytes});
 const manifest={schemaVersion:1,scope:'customer-text-cli-preview',fullZolaOs:false,node:'22.23.1',files:entries.map(({relative,data})=>({path:relative,sha256:createHash('sha256').update(data).digest('hex')}))};
 fs.writeFileSync(path.join(out,'bundle-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return {directory:out,scope:manifest.scope,files:entries.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 try{if(args.length!==2||args[0]!=='--output')throw Error('USAGE');console.log(JSON.stringify(packageCustomer(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args[1])));}
 catch{console.error('Bundle creation refused or incomplete. Use a new absolute output directory outside the source tree.');process.exitCode=1;}
}
