import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {verifyReleaseSource} from '../packages/zola-release/commander-host.js';
import {prepareOwnedSuccessorPreview,createOwnedSuccessorPreviewHost,createOwnedSuccessorPreviewTransport} from '../packages/zola-release/owned-successor-preview.js';
let journal;
try{const [flag,releaseSha,...rest]=process.argv.slice(2);if(flag!=='--prepare'||rest.length||process.getuid?.()!==0||process.versions.node!=='22.23.1')throw Error();verifyReleaseSource(releaseSha);journal=openReleaseJournal();const host=createOwnedSuccessorPreviewHost(releaseSha);process.stdout.write(JSON.stringify(await prepareOwnedSuccessorPreview({releaseSha},{host,transport:createOwnedSuccessorPreviewTransport(host)}))+'\n');}
catch{process.stderr.write('Owned successor preview refused; retain isolated intent and deployment ID.\n');process.exitCode=1;}finally{journal?.close();}
