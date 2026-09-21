#!/usr/bin/env node
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {verifyReleaseSource} from '../packages/zola-release/commander-host.js';
import {createOwnedBuyerConfigurationHost} from '../packages/zola-release/owned-buyer-configuration-host.js';
import {createOwnedBuyerVercelTransport,prepareOwnedBuyerFrontend,publishOwnedBuyerApi} from '../packages/zola-release/owned-buyer-configuration.js';
import {prepareOwnedBuyerNginx} from '../packages/zola-release/owned-buyer-nginx.js';
import {createOwnedBuyerNginxHost} from '../packages/zola-release/owned-buyer-nginx-host.js';
let guard;
try{
 const [mode,releaseSha,...extra]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||!['--frontend','--api','--nginx'].includes(mode)||extra.length)throw new Error('arguments');
 verifyReleaseSource(releaseSha);guard=openReleaseJournal();const host=createOwnedBuyerConfigurationHost({releaseSha}),transport=createOwnedBuyerVercelTransport({token:host.token});
 const result=mode==='--nginx'?await prepareOwnedBuyerNginx({releaseSha},{host:createOwnedBuyerNginxHost(host)}):await(mode==='--frontend'?prepareOwnedBuyerFrontend:publishOwnedBuyerApi)({releaseSha},{host,transport});process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Owned Buyer configuration refused; protected state retained and credentials not disclosed\n');process.exitCode=1;}
finally{guard?.close();}
