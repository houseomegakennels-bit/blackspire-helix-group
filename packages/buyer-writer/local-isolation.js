import {validateBuyerWriterClientConfiguration} from './configuration.js';
import {validateApplicationDatabaseIsolation} from '../shared/security.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

// Converts already-collected, non-secret host/protocol observations into release
// evidence. It performs no network access and treats every missing, extra or
// malformed observation as false. Provider ACL state is intentionally outside
// this proof and must continue to be reported separately.
export function verifyBuyerWriterLocalIsolation({clientConfiguration,workspace,environmentName='production',applicationEnvironments,socket,service,protocol}={}) {
  let clientValid=false;
  try{validateBuyerWriterClientConfiguration(clientConfiguration,{workspace,environment:environmentName});clientValid=true;}catch{}
  const applicationDbCredentialsAbsent=clientValid&&environmentName==='production'&&Array.isArray(applicationEnvironments)
    &&applicationEnvironments.length===2&&applicationEnvironments.map(value=>value?.BLACKSPIRE_RUNTIME_USER).sort().join(',')==='blackspire-api,blackspire-worker'
    &&applicationEnvironments.every(environment=>environment&&typeof environment==='object'&&!Array.isArray(environment)
      &&environment.NODE_ENV==='production'&&environment.BLACKSPIRE_RUNTIME_MODE==='production'
      &&validateApplicationDatabaseIsolation(environment).ok);
  const gatewayTransportVerified=clientValid
    &&exact(socket,['path','type','owner','group','mode','parent'])
    &&socket.path==='/run/blackspire/buyer-writer.sock'&&socket.type==='socket'
    &&socket.owner==='blackspire-writer'&&socket.group==='blackspire-api'&&socket.mode===0o660
    &&exact(socket.parent,['path','owner','group','mode'])&&socket.parent.path==='/run/blackspire'
    &&['root','blackspire-writer'].includes(socket.parent.owner)&&socket.parent.group==='blackspire-api'&&socket.parent.mode===0o750
    &&exact(service,['user','group','configOwner','configGroup','configMode','tcpListeners'])
    &&service.user==='blackspire-writer'&&service.group==='blackspire-api'
    &&service.configOwner==='blackspire-writer'&&service.configGroup==='blackspire-writer'&&service.configMode===0o600
    &&service.tcpListeners===0;
  const arbitrarySqlDenied=exact(protocol,['arbitrarySqlDenied','arbitraryFunctionDenied','arbitraryUrlDenied'])&&protocol.arbitrarySqlDenied===true;
  const arbitraryFunctionDenied=exact(protocol,['arbitrarySqlDenied','arbitraryFunctionDenied','arbitraryUrlDenied'])&&protocol.arbitraryFunctionDenied===true;
  const arbitraryUrlDenied=exact(protocol,['arbitrarySqlDenied','arbitraryFunctionDenied','arbitraryUrlDenied'])&&protocol.arbitraryUrlDenied===true;
  const evidence=Object.freeze({applicationDbCredentialsAbsent,gatewayTransportVerified,arbitrarySqlDenied,arbitraryFunctionDenied,arbitraryUrlDenied});
  return Object.freeze({ok:Object.values(evidence).every(Boolean),...evidence});
}
