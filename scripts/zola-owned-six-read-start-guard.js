import {register} from 'node:module';
import {OWNED_SIX_READ,assertOwnedSixReadStart} from '../packages/zola-release/owned-six-read-overlay.js';
let journal;
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==2)throw Error('Guard arguments');
 register('file://'+OWNED_SIX_READ.frozenRoot+'/packages/zola-release/owned-sequence-loader.js',import.meta.url);
 const {openReleaseJournal}=await import(OWNED_SIX_READ.frozenRoot+'/packages/zola-release/commander-journal.js');
 const {inspectReleaseSequenceHistory,RELEASE_STAGES}=await import(OWNED_SIX_READ.frozenRoot+'/packages/zola-release/commander-sequence.js');
 journal=openReleaseJournal();
 assertOwnedSixReadStart({state:inspectReleaseSequenceHistory(journal.stream('release').events()),n8nEvents:journal.stream('n8n').events(),stages:RELEASE_STAGES});
 process.stdout.write('OWNED_SIX_READ_START_VERIFIED\n');
}catch{process.stderr.write('Owned six-read start refused\n');process.exitCode=1;}finally{journal?.close();}
