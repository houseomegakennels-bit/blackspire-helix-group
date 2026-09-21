import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {OWNED_BUYER_COPY_ORDER} from './owned-data-migration.js';
const baseline=JSON.parse(fs.readFileSync(new URL('./owned-source-schema.json',import.meta.url),'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const quote=value=>{if(typeof value!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))throw new Error('Owned Buyer schema rejected');return `"${value}"`;};
export const OWNED_SOURCE_CATALOG_DIGEST=digest(baseline);
export const OWNED_AUTH_UID_BODY="select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid";
const types=new Set(['uuid','text','boolean','integer','numeric','date','text[]','jsonb','timestamp with time zone']);
const defaults=new Set(['gen_random_uuid()','false','0','1','now()',"'pending'::text"]);
const expressions=new Set(['true','(user_id = auth.uid())','(auth.uid() = user_id)']);
// Source is a reviewed metadata-only catalog, never executable SQL input. Exact
// catalog match refuses unknown dependencies or drift before generating DDL.
// Provider administrative schema/function owners are intentionally not cloned;
// the owned cluster postgres role owns this minimal auth.uid dependency instead.
export function prepareOwnedBuyerSchema(catalog){
 if(digest(catalog)!==OWNED_SOURCE_CATALOG_DIGEST)throw new Error('Owned Buyer schema catalog drift');
 const statements=['CREATE ROLE anon NOLOGIN','CREATE ROLE authenticated NOLOGIN','CREATE ROLE service_role NOLOGIN BYPASSRLS',
  'SET LOCAL ROLE postgres','CREATE SCHEMA auth AUTHORIZATION postgres',`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $owned_uid$${OWNED_AUTH_UID_BODY}$owned_uid$`,
  'REVOKE ALL ON SCHEMA auth FROM PUBLIC','GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role',
  'REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC','GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role'];
 for(const name of OWNED_BUYER_COPY_ORDER){
  const relation=catalog.relations.find(row=>row.name===name);
  const columns=relation.columns.map(column=>{
   if(!types.has(column.type)||column.default!==null&&!defaults.has(column.default)||column.generated!==''||column.identity!==''||column.acl!==null)throw new Error('Owned Buyer column rejected');
   return `${quote(column.name)} ${column.type}${column.default===null?'':` DEFAULT ${column.default}`}${column.notNull?' NOT NULL':''}`;
  });
  statements.push(`CREATE TABLE public.${quote(name)} (${columns.join(',')})`);
  for(const constraint of relation.constraints){
   // Exact baseline text has been independently bounded by the full catalog
   // digest. Qualify the only two referenced tables explicitly; no search-path
   // resolution of provider objects or arbitrary extracted DDL is permitted.
   let definition=constraint.definition;
   if(!['p','u','f','c'].includes(constraint.type)||!constraint.validated||constraint.deferrable||constraint.initiallyDeferred)throw new Error('Owned Buyer constraint rejected');
   definition=definition.replaceAll('REFERENCES "SearchJob"','REFERENCES public."SearchJob"').replaceAll('REFERENCES "BuyerProfile"','REFERENCES public."BuyerProfile"');
   statements.push(`ALTER TABLE public.${quote(name)} ADD CONSTRAINT ${quote(constraint.name)} ${definition}`);
  }
  statements.push(`ALTER TABLE public.${quote(name)} ENABLE ROW LEVEL SECURITY`);
  statements.push(`REVOKE ALL ON TABLE public.${quote(name)} FROM PUBLIC,anon,authenticated,service_role`);
  // Reproduce the captured baseline ACL while all roles remain NOLOGIN and the
  // target has no business transport. Mandatory release hardening follows before
  // activation; this schema/copy package cannot open runtime access.
  statements.push(`GRANT ALL PRIVILEGES ON TABLE public.${quote(name)} TO anon,authenticated,service_role`);
  for(const policy of relation.policies){
   const command={r:'SELECT',a:'INSERT',w:'UPDATE'}[policy.command];
   if(!command||!policy.permissive||![policy.using,policy.check].every(value=>value===null||expressions.has(value)))throw new Error('Owned Buyer policy rejected');
   const roles=policy.roles.map(role=>role==='PUBLIC'?'PUBLIC':quote(role)).join(',');
   statements.push(`CREATE POLICY ${quote(policy.name)} ON public.${quote(name)} AS PERMISSIVE FOR ${command} TO ${roles}${policy.using===null?'':` USING (${policy.using})`}${policy.check===null?'':` WITH CHECK (${policy.check})`}`);
  }
 }
 return Object.freeze({kind:'owned-buyer-schema-v1',sourceCatalogDigest:OWNED_SOURCE_CATALOG_DIGEST,
  body:statements.join(';\n')+';\n',authUidOwnerTranslation:'provider-owner-to-postgres',businessActivation:false});
}
