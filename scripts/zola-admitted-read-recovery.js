import {observeAdmittedReadRecovery} from '../packages/zola-release/admitted-read-recovery-host.js';
try{
 if(process.argv.length!==3||process.argv[2]!=='--inspect')throw Error();
 console.log(JSON.stringify(await observeAdmittedReadRecovery()));
}catch{console.error('Admitted-read recovery inspection refused; preserve the failed task and release evidence.');process.exitCode=1;}
