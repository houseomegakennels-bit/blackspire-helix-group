#!/usr/bin/env node
import {prepareInitialBuyerStore} from '../packages/buyer-store/initial-host.js';
try{const [flag,releaseSha,operationId,...rest]=process.argv.slice(2);if(flag!=='--prepare'||rest.length||process.versions.node!=='22.23.1'||process.getuid?.()!==0||process.geteuid?.()!==0)throw new Error();process.stdout.write(JSON.stringify(await prepareInitialBuyerStore(releaseSha,operationId))+'\n');}catch{process.stderr.write('Owned repository preparation refused; retain records and reconcile.\n');process.exitCode=1;}
