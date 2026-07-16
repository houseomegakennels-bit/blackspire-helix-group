import {claimNext,getFlag} from '../../packages/task-engine/tasks.js'; import {processTask} from '../../packages/hermes/hermes.js';
setInterval(async()=>{ if(getFlag('emergency_stop')==='active') return; const task=claimNext(); if(task) await processTask(task);},1500);
