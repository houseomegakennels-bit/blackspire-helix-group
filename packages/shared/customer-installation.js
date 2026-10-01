import fs from 'node:fs';
import path from 'node:path';

const providers = new Set(['none','openai','anthropic']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function deny(code) { throw new Error(code); }
function privateFile(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile() || stat.nlink!==1 || (stat.mode&0o077)!==0 || stat.uid!==process.getuid() || stat.size>65536)
      deny('CUSTOMER_CONFIG_PERMISSIONS');
    return fs.readFileSync(fd,'utf8');
  } finally {fs.closeSync(fd);}
}
function privateDirectory(directory) {
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory() || (stat.mode&0o077)!==0 || stat.uid!==process.getuid())
    deny('CUSTOMER_DIRECTORY_PERMISSIONS');
}
export function loadCustomerInstallation(directory) {
  try {
    if(!path.isAbsolute(directory)) deny('CUSTOMER_DIRECTORY_REQUIRED');
    const root=path.resolve(directory);
    privateDirectory(root);
    // A private, same-owner root is required; destination symlinks are rejected.
    privateDirectory(path.join(root,'secrets'));
    const manifest=JSON.parse(privateFile(path.join(root,'installation.json')));
    const credentials=JSON.parse(privateFile(path.join(root,'secrets/providers.json')));
    if(manifest.schemaVersion!==1 || credentials.schemaVersion!==1 || !uuid.test(manifest.installationId) ||
      manifest.installationId!==credentials.installationId) deny('CUSTOMER_IDENTITY_MISMATCH');
    if(manifest.credentialSource!=='installation_only' || manifest.fallbackCredentials!==false ||
      !providers.has(manifest.ai?.provider) || manifest.ai.fallbackProvider!==null)
      deny('CUSTOMER_PROVIDER_POLICY');
    if(!credentials.providers || typeof credentials.providers!=='object' || Array.isArray(credentials.providers))
      deny('CUSTOMER_CREDENTIAL_SCHEMA');
    // No ambient environment, shared credential store, home directory or default provider lookup.
    return {manifest,credentials};
  } catch { deny('CUSTOMER_CONFIGURATION_REJECTED'); }
}
export function customerProviderStatus(installation) {
  const {manifest,credentials}=installation;
  const provider=manifest.ai.provider;
  const binding=credentials.providers[provider];
  const connected=provider!=='none' && binding?.installationId===manifest.installationId &&
    binding?.provider===provider && typeof binding.apiKey==='string' && binding.apiKey.trim().length>0;
  return {
    provider,
    status:provider==='none'?'skipped':connected?'configured_not_verified':'needs_credentials',
    runtimeReady:false,
    reason:'customer_runtime_not_admitted',
    // Provider selection and key presence are never proof of authentication or spend authority.
    fallbackProvider:null
  };
}
export function selectCustomerProvider(manifest,provider) {
  if(!providers.has(provider) || !uuid.test(manifest?.installationId)) deny('CUSTOMER_PROVIDER_SELECTION_REJECTED');
  return {
    ...manifest,
    ai:{provider,connectionStatus:provider==='none'?'skipped':'needs_credentials',fallbackProvider:null},
    modules:{...manifest.modules,cloudAi:{enabled:false}},
    status:'prepared_not_runnable'
  };
}
