#!/usr/bin/env node
import {backupCustomer,restoreCustomer} from '../packages/customer/backup.mjs';
// Passphrase comes only from bounded stdin JSON, never arguments or environment variables.
try{
 const [action,source,destination,...extra]=process.argv.slice(2);
 if(!['backup','restore'].includes(action)||!source||!destination||extra.length)throw Error('USAGE');
 let bytes=0;const chunks=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8192)throw Error('INPUT_LIMIT');chunks.push(chunk);}
 const {passphrase}=JSON.parse(Buffer.concat(chunks).toString());
 console.log(JSON.stringify(action==='backup'?backupCustomer(source,destination,passphrase):restoreCustomer(source,destination,passphrase)));
}catch{console.error('Recovery operation refused or incomplete. Backup requires a paused, reconciled installation and a new private output file. Restore requires a fresh directory and correct passphrase. Restored installations remain held for reconciliation.');process.exitCode=1;}
