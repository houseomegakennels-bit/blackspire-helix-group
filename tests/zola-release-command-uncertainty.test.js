import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('unreadable release history reports unknown mutation outcome without exposing journal diagnostics',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zola-command-uncertainty-'));
 try{
  const journalUrl=new URL('../packages/zola-release/commander-journal.js',import.meta.url).href;
  const cliUrl=new URL('../scripts/zola-release-command.js',import.meta.url).href;
  const source=`
   import fs from 'node:fs';
   import {registerHooks} from 'node:module';
   const directory=${JSON.stringify(directory)};
   process.getuid=()=>0;
   const stat=fs.lstatSync;
   fs.lstatSync=(p,...args)=>{const value=stat(p,...args);if(p===directory)value.uid=0;return value;};
   registerHooks({load(url,context,next){
    const loaded=next(url,context);if(url!==${JSON.stringify(journalUrl)})return loaded;
    let source=String(loaded.source);
    const original="export function openReleaseJournal({root=RELEASE_OPERATION_ROOT,owner=0}={}){";
    if(source.split(original).length!==2)throw new Error('fixture composition changed');
    source=source.replace("export const RELEASE_OPERATION_ROOT='/var/lib/blackspire-operator/release-operations';",'export const RELEASE_OPERATION_ROOT='+JSON.stringify(directory+'/journal')+';');
    source=source.replace(original,original+"fs.writeFileSync("+JSON.stringify(directory+'/attempted')+",'yes');throw new Error('PRIVATE_JOURNAL_DIAGNOSTIC');");
    return {...loaded,source};
   }});
   process.argv=[process.execPath,'scripts/zola-release-command.js','--inspect'];
   await import(${JSON.stringify(cliUrl)});
  `;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',timeout:10000,maxBuffer:8192,
   env:{PATH:'/usr/bin:/bin',HOME:directory,LC_ALL:'C'}});
  assert.equal(result.status,1,result.stderr);
  assert.equal(fs.readFileSync(path.join(directory,'attempted'),'utf8'),'yes');
  const report=JSON.parse(result.stdout);
  assert.equal(report.reason,'COMMAND_FAILED_CLOSED');
  assert.equal(report.releaseReady,false);
  assert.equal(report.mutationSent,null);
  assert.equal(report.reconciliationRequired,true);
  assert.equal((result.stdout+result.stderr).includes('PRIVATE_JOURNAL_DIAGNOSTIC'),false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
