import path from 'node:path';
import {matchesBuyerWriterRehearsal} from './rehearsal.js';
const exact=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)
  &&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const secret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)
  &&Buffer.from(value,'base64url').length===32&&Buffer.from(value,'base64url').toString('base64url')===value;

// Pure validation of an explicitly supplied protected configuration. No
// environment lookup, fallback credentials, connection URL or role override.
export function validateBuyerWriterConfiguration(value,{workspace,environment='production',rehearsal}={}) {
  try {
    if(typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||!exact(value,['version','workspace','bindingFile','writerCredential','issuerCredential','runtime','issuer'],['units','rehearsalFile'])
      ||value.version!==1||value.workspace!==workspace||typeof value.bindingFile!=='string'||value.bindingFile.length>4096
      ||!path.isAbsolute(value.bindingFile)||path.resolve(value.bindingFile)!==value.bindingFile||value.bindingFile==='/')throw new Error();
    for(const config of [value.runtime,value.issuer]){
      if(!exact(config,['host','port','database','password'],['ca'])||typeof config.host!=='string'||config.host.length>253
        ||!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config.host)||!Number.isInteger(config.port)||config.port<1||config.port>65535
        ||typeof config.database!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(config.database)
        ||(config.ca!==undefined&&(typeof config.ca!=='string'||config.ca.length>16384||!config.ca.includes('-----BEGIN CERTIFICATE-----'))))throw new Error();
    }
    const isolatedProduction=environment==='production'&&matchesBuyerWriterRehearsal(rehearsal,value,workspace);
    if(value.rehearsalFile!==undefined&&!isolatedProduction)throw new Error();
    if(value.units!==undefined){
      if((!['staging','disposable-staging'].includes(environment)&&!isolatedProduction)||!exact(value.units,['api','worker'])
        ||Object.values(value.units).some(unit=>typeof unit!=='string'||!/^[A-Za-z0-9_.@:-]{1,128}\.service$/.test(unit)
          ||['blackspire-command.service','blackspire-command-worker.service'].includes(unit))||value.units.api===value.units.worker)throw new Error();
    }
    const credentials=[value.writerCredential,value.issuerCredential,value.runtime.password,value.issuer.password];
    if(credentials.some(value=>!secret(value))||new Set(credentials).size!==4
      ||value.runtime.host.toLowerCase()!==value.issuer.host.toLowerCase()||value.runtime.port!==value.issuer.port
      ||value.runtime.database!==value.issuer.database)throw new Error();
    return Object.freeze({...value,runtime:Object.freeze({...value.runtime}),issuer:Object.freeze({...value.issuer}),...(value.units?{units:Object.freeze({...value.units})}:{})});
  }catch{throw new Error('Buyer writer configuration rejected');}
}
