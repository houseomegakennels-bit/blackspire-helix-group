import {execFileSync} from 'node:child_process';
import {fail} from './local-protocol.js';
const units=Object.freeze(['blackspire_2dcommand_2eservice','blackspire_2dcommand_2dworker_2eservice']);
// Explicit read-only bus calls work in RootDirectory without PID1/systemctl
// discovery. Peer authentication uses the existing confined service identity.
export function observeBuyerStoreGenerations({run=execFileSync}={}){
 return units.map(unit=>{
  const text=run('/usr/bin/busctl',['--address=unix:path=/run/dbus/system_bus_socket','--json=short','get-property','org.freedesktop.systemd1','/org/freedesktop/systemd1/unit/'+unit,'org.freedesktop.systemd1.Unit','InvocationID'],{encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});
  if(typeof text!=='string'||text.length>4096)fail();
  let value;try{value=JSON.parse(text);}catch{fail();}
  if(!value||Object.keys(value).sort().join(',')!=='data,type'||value.type!=='ay'||!Array.isArray(value.data)||value.data.length!==16||value.data.some(n=>!Number.isInteger(n)||n<0||n>255)||value.data.every(n=>n===0))fail();
  return Buffer.from(value.data).toString('hex');
 });
}
