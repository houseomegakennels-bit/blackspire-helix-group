#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDisposableRestoreCutover } from '../packages/recovery/disposable-rehearsal.js';
const args=process.argv.slice(2); const value=(name)=>{const index=args.indexOf(name);return index<0?null:args[index+1];};
const repository=path.resolve(import.meta.dirname,'..'); const status=spawnSync('/usr/bin/git',['-C',repository,'status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
const report=runDisposableRestoreCutover({repository,root:value('--root'),environment:value('--environment'),operatorAck:value('--operator-ack'),expectedCommit:value('--commit'),rollbackCommit:value('--rollback'),treeClean:status.status===0&&status.stdout==='',cleanup:!args.includes('--preserve-fixture')});
console.log(JSON.stringify(report,null,2)); process.exit(report.goNoGo==='GO_FOR_DISPOSABLE_REHEARSAL'?0:1);
