#!/usr/bin/env node
import {register} from 'node:module';
register(new URL('../packages/zola-release/owned-sequence-loader.js',import.meta.url));
try{if(process.argv.length!==3||process.argv[2]!=='--cleanup-failed-workflow')throw Error('args');const {cleanupOwnedN8nCloudFailureNative}=await import('../packages/zola-release/owned-n8n-cloud-host.js');process.stdout.write(JSON.stringify(await cleanupOwnedN8nCloudFailureNative())+'\n');}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'FAILED_CLOUD_WORKFLOW_CLEANUP_REJECTED',releaseReady:false})+'\n');process.exitCode=1;}
