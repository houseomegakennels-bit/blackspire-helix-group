import fs from 'node:fs';
import path from 'node:path';
import {loadCustomerInstallation} from '../shared/customer-installation.js';
import {exclusive,privateDirectory,readPrivate,atomicPrivate,fail} from './private-files.mjs';
const MODULES={
 cloudAi:{label:'AI text assistant',accounts:['Your OpenAI API account or Anthropic API account'],implementation:'cli_preview',billing:'Customer pays the selected provider; usage varies.'},
 voice:{label:'Natural voice',accounts:['Your compatible voice API account'],implementation:'customer_integration_not_implemented',billing:'Separate usage charges; current quote required.'},
 telegram:{label:'Telegram access',accounts:['Your Telegram account and bot'],implementation:'customer_integration_not_implemented',billing:'Account, hosting and provider costs require review.'},
 social:{label:'Social media management',accounts:['Your selected social platform accounts and app permissions'],implementation:'customer_integration_not_implemented',billing:'Platform and optional publishing service costs require review.'}
};
const choices=['connect','create','skip'];
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function readPreferences(root,id){
 const file=path.join(root,'onboarding.json');if(!exists(file))return {schemaVersion:1,installationId:id,choices:{}};
 const p=JSON.parse(readPrivate(file));
 if(p.schemaVersion!==1||p.installationId!==id||!p.choices||typeof p.choices!=='object'||Array.isArray(p.choices)||Object.keys(p).some(k=>!['schemaVersion','installationId','choices'].includes(k))||Object.entries(p.choices).some(([k,v])=>!Object.hasOwn(MODULES,k)||!choices.includes(v)))fail('ONBOARDING_INVALID');
 return p;
}
export function selectCustomerModule(root,{module,choice,...extra}){
 if(Object.keys(extra).length||!Object.hasOwn(MODULES,module)||!choices.includes(choice))fail('ONBOARDING_CHOICE_INVALID');
 privateDirectory(root);return exclusive(root,()=>{
  const {manifest}=loadCustomerInstallation(root);const p=readPreferences(root,manifest.installationId);
  p.choices[module]=choice;atomicPrivate(path.join(root,'onboarding.json'),JSON.stringify(p,null,2)+'\n');
  // An onboarding choice is a preference only: never modifies credentials, policy or admission.
  return {module,choice,saved:true,enabled:false,meaning:'preference_only',accountCreated:false};
 });
}
export function customerOnboarding(root){
 privateDirectory(root);return exclusive(root,()=>{
  const {manifest}=loadCustomerInstallation(root),p=readPreferences(root,manifest.installationId);
  const modules=Object.entries(MODULES).map(([id,spec])=>{
   const choice=p.choices[id]??(id==='cloudAi'&&manifest.ai.provider==='none'?'skip':'undecided');
   return {id,...spec,choice,optional:true,credentialOwner:'customer',billingOwner:'customer',connected:null,connectionVerified:false,runtimeState:'not_inspected',
    next:choice==='skip'?'No new account requested. This preference does not disable an existing runtime; pause it separately.':choice==='create'?'Create your own account; this preference does not create or purchase one.':choice==='connect'?'Connect only your own account through the module setup when available.':'Choose Connect, Create or Skip.'};
  });
  return {scope:'customer_onboarding_preview',installationId:manifest.installationId,fullOsReady:false,customerOwnedOnly:true,usesBlackspireAccounts:false,
   aiProvider:manifest.ai.provider,providerChoices:['openai','anthropic','none'],
   core:{plannedThirdPartyAccountsRequired:[],hosting:'Customer-owned device or hosting required.',implementation:'full_customer_os_not_installed'},
   costs:{currency:'USD',coreTotal:null,selectedModulesTotal:null,fullImplementationTotal:null,status:'quote_required',note:'Unknown costs are not zero. No purchase, paid request or account enrollment occurs during this checklist.'},modules,
   pending:['Customer web/Telegram onboarding integration','Customer service and HTTPS installation','Live customer acceptance','Verified account-specific core and full cost quotes']};
 });
}
