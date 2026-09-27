import {createTelegramFeatureHost} from '../packages/zola-release/telegram-feature-host.js';
import {runFeatureRelease} from '../packages/zola-release/feature-release.js';
const host=createTelegramFeatureHost();
try{if(process.argv[2]==='--apply')console.log(JSON.stringify(await runFeatureRelease(host)));else{await host.preflight();console.log('FEATURE_TRANSACTION_PREFLIGHT_VERIFIED');}}
catch{console.error('Feature transaction did not complete; inspect protected evidence before retry.');process.exitCode=1;}
finally{host.close();}
