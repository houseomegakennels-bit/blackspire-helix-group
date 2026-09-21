import {verifyRuntimeBuyerWriterArtifact} from '../buyer-writer/artifact.js';
import {resolveBuyerStoreIdentity} from './identity.js';
try{
 if(process.argv.length!==5||process.versions.node!=='22.23.1'||process.geteuid()!==process.getuid())throw new Error();
 resolveBuyerStoreIdentity();
 const [artifactRoot,releaseSha,environment]=process.argv.slice(2);
 if(environment!=='production'||artifactRoot!=='/opt/blackspire-command/releases/'+releaseSha)throw new Error();
 process.stdout.write(JSON.stringify(verifyRuntimeBuyerWriterArtifact({artifactRoot,releaseSha,environment}))+'\n');
}catch{process.stderr.write('Buyer store runtime artifact verification rejected\n');process.exitCode=1;}
