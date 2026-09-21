import test from 'node:test';
import assert from 'node:assert/strict';
import {PREDECESSOR_MAIN,SUCCESSOR_MAIN,bindSuccessorMain,observeSuccessorMain} from '../packages/zola-release/owned-successor-main.js';
test('new main binding preserves immutable predecessor input and unrelated lineage',()=>{
 const old=Object.freeze({previousMainSha:PREDECESSOR_MAIN,recoverySha:'retained',sourceSecurityConfigurationFile:'retained-source'});
 assert.deepEqual(bindSuccessorMain(old,SUCCESSOR_MAIN),{...old,previousMainSha:SUCCESSOR_MAIN});
 assert.equal(old.previousMainSha,PREDECESSOR_MAIN);
 for(const main of [PREDECESSOR_MAIN,'a'.repeat(40),undefined])assert.throws(()=>bindSuccessorMain(old,main));
 assert.throws(()=>bindSuccessorMain({...old,previousMainSha:SUCCESSOR_MAIN},SUCCESSOR_MAIN));
});
test('fixed trusted remote and both ancestry edges are required',()=>{
 const sha='b'.repeat(40),calls=[];
 const run=(bin,args,options)=>{assert.equal(bin,'/usr/bin/git');assert.equal(options.env.GIT_NO_REPLACE_OBJECTS,'1');calls.push(args);return args.includes('ls-remote')?`${SUCCESSOR_MAIN}\trefs/heads/main\n`:'';};
 assert.equal(observeSuccessorMain(sha,{run}),SUCCESSOR_MAIN);
 assert.ok(calls[0].includes('https://github.com/houseomegakennels-bit/blackspire-helix-group.git'));
 assert.deepEqual(calls.slice(1).map(a=>a.slice(-4)),[['merge-base','--is-ancestor',PREDECESSOR_MAIN,SUCCESSOR_MAIN],['merge-base','--is-ancestor',SUCCESSOR_MAIN,sha]]);
 for(const main of [PREDECESSOR_MAIN,'a'.repeat(40)])assert.throws(()=>observeSuccessorMain(sha,{run:()=>`${main}\trefs/heads/main`}));
 for(const edge of [PREDECESSOR_MAIN,SUCCESSOR_MAIN])assert.throws(()=>observeSuccessorMain(sha,{run:(bin,args)=>{if(args.includes('ls-remote'))return `${SUCCESSOR_MAIN}\trefs/heads/main`;if(args.at(-2)===edge)throw Error('not ancestor');return '';}}));
});
