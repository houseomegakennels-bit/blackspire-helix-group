import {createOwnedStoreTransition} from './owned-store-transition.js';
import {publishBuyerStoreInstalledManifest} from '../buyer-store/manifest-publication.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';

// Runtime manifest publication follows the exact candidate deployment. Both
// nested publishers must attest the deployed artifact, not a predeployment seal.
// Preparation, retained files, current pointer, and generation fences are unchanged.
export function createOwnedRuntimeStoreTransition({transition=createOwnedStoreTransition,publish=publishBuyerStoreInstalledManifest,inspect=inspectBuyerWriterArtifact}={}){
 const base=transition();
 const runtime=transition({inspect,publishManifest:binding=>publish(binding,{inspect})});
 return {...base,publishManifest:runtime.publishManifest};
}
