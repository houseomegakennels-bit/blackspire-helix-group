#!/usr/bin/env node
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {publishPublicCommandRouting} from '../packages/zola-release/public-command-routing-host.js';
let journal;
try{const [mode,releaseSha,newMainSha,profileDigest,...rest]=process.argv.slice(2);if(process.getuid()!==0||process.versions.node!=='22.23.1'||!['--prepare','--restore'].includes(mode)||rest.length)throw Error();journal=openReleaseJournal();process.stdout.write(JSON.stringify(await publishPublicCommandRouting({releaseSha,newMainSha,profileDigest,journal},{restore:mode==='--restore'}))+'\n');}
catch{process.stderr.write('Public command routing refused; retained evidence preserved\n');process.exitCode=1;}
finally{journal?.close();}
