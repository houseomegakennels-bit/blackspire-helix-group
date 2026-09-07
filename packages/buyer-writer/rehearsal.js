const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const port=value=>Number.isInteger(value)&&value>=40000&&value<=49000;
const proofs=new WeakMap();
const targets=config=>JSON.stringify([config.runtime,config.issuer].map(value=>({host:value?.host,port:value?.port,database:value?.database,ca:value?.ca})));

export function matchesBuyerWriterRehearsal(proof,config,workspace){
  const expected=proofs.get(proof);
  return Boolean(expected&&expected.workspace===workspace&&expected.rehearsalFile===config.rehearsalFile
    &&expected.bindingFile===config.bindingFile&&expected.api===config.units?.api&&expected.worker===config.units?.worker&&expected.targets===targets(config));
}

// Pure scope validation for a separately protected root descriptor. This does
// not authorize startup: the root launcher must first verify actual paths and
// both roles' environment files before spawning either supervisor. The API
// independently supplies its resolved startup settings before creating pools.
export function validateBuyerWriterRehearsal(value,config,{configurationFile,workspace,releaseSha,environment,startup}={}){
  try{
    if(!exact(value,['version','kind','id','releaseSha','workspace','port','postgresPort'])||value.version!==1
      ||value.kind!=='isolated-production-rehearsal'||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(value.id??'')
      ||!/^[a-f0-9-]{36}$/.test(value.id)||!/^[a-f0-9]{40}$/.test(releaseSha??'')||value.releaseSha!==releaseSha
      ||typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)||value.workspace!==workspace
      ||environment!=='production'||!port(value.port)||!port(value.postgresPort)||value.port===value.postgresPort)throw new Error();
    const root=`/var/lib/blackspire-zola-rehearsal/activation/${value.id}`;
    const units={api:`zola-writer-api-${value.id}.service`,worker:`zola-writer-worker-${value.id}.service`};
    if(configurationFile!==`${root}/config/writer.json`||config?.rehearsalFile!==`${root}/config/rehearsal.json`
      ||config.bindingFile!==`${root}/config/binding.json`||!exact(config.units,['api','worker'])
      ||Object.keys(units).some(key=>units[key]!==config.units[key])
      ||!exact(startup,['stateOwner','releaseRoot','artifactRoot','databasePath','dataDirectory','host','port'])
      ||startup.stateOwner!=='vps-production'||startup.releaseRoot!==root||startup.artifactRoot!==`${root}/releases/${releaseSha}`
      ||startup.databasePath!==`${root}/shared/database/command.sqlite`||startup.dataDirectory!==`${root}/shared`
      ||startup.host!=='127.0.0.1'||startup.port!==value.port)throw new Error();
    const database=`zola_writer_${value.id.replaceAll('-','')}`;
    for(const target of [config.runtime,config.issuer]){
      if(target?.host!=='localhost'||target.port!==value.postgresPort||target.database!==database
        ||typeof target.ca!=='string'||!target.ca.includes('-----BEGIN CERTIFICATE-----'))throw new Error();
    }
    const proof=Object.freeze({root,units:Object.freeze(units),releaseSha,workspace});
    proofs.set(proof,{workspace,rehearsalFile:config.rehearsalFile,bindingFile:config.bindingFile,api:units.api,worker:units.worker,targets:targets(config)});
    return proof;
  }catch{throw new Error('Buyer writer rehearsal configuration rejected');}
}
