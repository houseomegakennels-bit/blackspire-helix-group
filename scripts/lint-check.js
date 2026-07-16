import {spawnSync} from 'node:child_process'; const r=spawnSync('node',['--check','apps/api/server.js'],{stdio:'inherit'}); process.exit(r.status||0);
