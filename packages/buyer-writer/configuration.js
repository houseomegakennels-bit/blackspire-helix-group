import path from 'node:path';
import {matchesBuyerWriterRehearsal} from './rehearsal.js';
const exact=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)
  &&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
const secret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)
  &&Buffer.from(value,'base64url').length===32&&Buffer.from(value,'base64url').toString('base64url')===value;
const canonicalPath=value=>typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);

export function validateBuyerWriterGatewayAuthority(value,{workspace,releaseSha}={}) {
  try{
    if(!exact(value,['releaseSha','operationId','attemptId','workspace','gatewayIdentity'])||!sha(value.releaseSha)
      ||!uuid(value.operationId)||!uuid(value.attemptId)||typeof value.workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.workspace)
      ||value.gatewayIdentity!=='blackspire-writer'||workspace!==undefined&&value.workspace!==workspace
      ||releaseSha!==undefined&&value.releaseSha!==releaseSha)throw new Error();
    return Object.freeze({...value});
  }catch{throw new Error('Buyer writer gateway authority rejected');}
}

// Application-side configuration is a separate trust zone. It deliberately has
// no database host, port, URI, role, password or CA and accepts no extra keys.
export function validateBuyerWriterClientConfiguration(value,{workspace,environment='production'}={}) {
  try {
    if(typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||!exact(value,['version','workspace','socketPath','gatewayCapability','authority'])
      ||value.version!==3||value.workspace!==workspace||!canonicalPath(value.socketPath)
      ||(environment==='production'&&value.socketPath!=='/run/blackspire/buyer-writer.sock'))throw new Error();
    if(!secret(value.gatewayCapability))throw new Error();
    const authority=validateBuyerWriterGatewayAuthority(value.authority,{workspace});
    return Object.freeze({...value,authority});
  }catch{throw new Error('Buyer writer client configuration rejected');}
}

// Root/operator provisioning input. The installer consumes this protected value
// and publishes two smaller files; application services never receive this
// object because it contains the gateway's database login material.
export function validateBuyerWriterGatewayProvisioningConfiguration(value,{workspace}={}) {
  try {
    if(typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||!exact(value,['version','workspace','bindingFile','writerCredential','issuerCredential','gatewayCapability','authority','runtime','issuer'])
      ||value.version!==3||value.workspace!==workspace||!canonicalPath(value.bindingFile))throw new Error();
    for(const config of [value.runtime,value.issuer]){
      if(!exact(config,['host','port','database','password'],['ca'])||typeof config.host!=='string'||config.host.length>253
        ||!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config.host)||!Number.isInteger(config.port)||config.port<1||config.port>65535
        ||typeof config.database!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(config.database)
        ||(config.ca!==undefined&&(typeof config.ca!=='string'||config.ca.length>16384||!config.ca.includes('-----BEGIN CERTIFICATE-----'))))throw new Error();
    }
    const credentials=[value.writerCredential,value.issuerCredential,value.gatewayCapability,value.runtime.password,value.issuer.password];
    if(credentials.some(value=>!secret(value))||new Set(credentials).size!==credentials.length
      ||value.runtime.host.toLowerCase()!==value.issuer.host.toLowerCase()||value.runtime.port!==value.issuer.port
      ||value.runtime.database!==value.issuer.database)throw new Error();
    const authority=validateBuyerWriterGatewayAuthority(value.authority,{workspace});
    return Object.freeze({...value,authority,runtime:Object.freeze({...value.runtime}),issuer:Object.freeze({...value.issuer})});
  }catch{throw new Error('Buyer writer gateway provisioning configuration rejected');}
}

// Pure validation of an explicitly supplied protected configuration. No
// environment lookup, fallback credentials, connection URL or role override.
export function validateBuyerWriterConfiguration(value,{workspace,environment='production',rehearsal}={}) {
  try {
    if(typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||!exact(value,['version','workspace','bindingFile','writerCredential','issuerCredential','creatorOid','runtime','issuer'],['units','rehearsalFile'])
      ||value.version!==1||value.workspace!==workspace||!canonicalPath(value.bindingFile)
      ||!Number.isInteger(value.creatorOid)||value.creatorOid<1||value.creatorOid>4294967295)throw new Error();
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
