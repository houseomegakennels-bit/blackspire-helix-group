import {validateBuyerWriterClientConfiguration,
  validateBuyerWriterGatewayProvisioningConfiguration} from '../buyer-writer/configuration.js';

export function renderZolaGatewayConfigurations(value,{workspace='blackspire-command',
  environment='production'}={}){
  const config=validateBuyerWriterGatewayProvisioningConfiguration(value,{workspace});
  if(!config.operationPermitSignerConfiguration)throw new Error('Zola gateway configuration render rejected');
  const socketPath='/run/blackspire/buyer-writer.sock';
  const gatewayConfig=Object.freeze({
    version:4,
    mode:'research-admission',
    workspace:config.workspace,
    socketPath,
    gatewayCapability:config.gatewayCapability,
    creatorOid:config.creatorOid,
    authority:config.authority,
    runtime:config.runtime,
    issuer:config.issuer,
    admission:Object.freeze({
      connection:Object.freeze({
        host:config.runtime.host,
        port:config.runtime.port,
        database:config.runtime.database,
        user:'buyer_writer_admission_login',
        password:config.admissionCredential,
        ca:config.runtime.ca,
      }),
      operationPermitConfiguration:config.operationPermitConfiguration,
      verificationConfiguration:config.operationPermitVerificationConfiguration,
    }),
  });
  const clientConfig=validateBuyerWriterClientConfiguration({
    version:3,
    workspace:config.workspace,
    socketPath,
    gatewayCapability:config.gatewayCapability,
    authority:config.authority,
  },{workspace,environment});
  const ingressConfig=Object.freeze({
    version:1,
    workspace:config.workspace,
    bindingFile:config.bindingFile,
    writerCredential:config.writerCredential,
    issuerCredential:config.issuerCredential,
  });
  const signerConfig=Object.freeze({version:1,
    operationPermitConfiguration:config.operationPermitConfiguration,
    signer:config.operationPermitSignerConfiguration});
  return Object.freeze({config,gatewayConfig,clientConfig,ingressConfig,signerConfig});
}
