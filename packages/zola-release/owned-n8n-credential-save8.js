import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
export const SAVED8_UPDATED_AT='2026-09-22T23:16:49.971Z';
export const PRIOR7_UPDATED_AT='2026-09-21T22:55:51.254Z';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Public metadata only: this binds the one observed manual save, not its masked
// value or possession. Only eighth proof and seventh failure retirement use it.
export function validateOwnedN8nCredentialSave8(before,after){
 if(before?.updatedAt!==PRIOR7_UPDATED_AT||after?.updatedAt!==SAVED8_UPDATED_AT||before.id!=='RzOyDmXYmx58yZHi'||before.name!=='ZOLA Buyer writer'||before.type!=='httpHeaderAuth'||!isDeepStrictEqual({...before,updatedAt:null},{...after,updatedAt:null}))throw Error('Exact seventh-to-eighth credential save refused');
 return {version:1,kind:'owned-n8n-credential-save8',fromAttempt:7,toAttempt:8,credentialId:before.id,beforeDigest:hash(before),afterDigest:hash(after),beforeUpdatedAt:PRIOR7_UPDATED_AT,afterUpdatedAt:SAVED8_UPDATED_AT,positiveProof:false};
}
