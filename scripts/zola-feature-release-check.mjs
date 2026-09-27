import {checkFeatureRelease} from '../packages/zola-release/feature-release-preflight.js';
try {console.log(JSON.stringify(await checkFeatureRelease(process.argv[2])));}
catch {console.error('Feature release check failed; production unchanged.');process.exitCode=1;}
