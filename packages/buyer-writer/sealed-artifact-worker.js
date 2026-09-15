import {verifySealedBuyerWriterArtifact} from './artifact.js';
try{
  if(process.argv.length!==5||process.getuid()!==0||process.geteuid()!==0)throw new Error();
  const [artifactRoot,releaseSha,environment]=process.argv.slice(2);
  process.stdout.write(JSON.stringify(verifySealedBuyerWriterArtifact({artifactRoot,releaseSha,environment}))+'\n');
}catch{
  process.stderr.write('Sealed Buyer writer artifact verification rejected\n');process.exitCode=1;
}
