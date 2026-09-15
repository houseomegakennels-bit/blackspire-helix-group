import {BUYER_WRITER_LOCAL_STATEMENTS} from './local-gateway-server.js';

const allowed={runtime:new Set([BUYER_WRITER_LOCAL_STATEMENTS.apply,BUYER_WRITER_LOCAL_STATEMENTS.receipt,BUYER_WRITER_LOCAL_STATEMENTS.context]),
  issuer:new Set([BUYER_WRITER_LOCAL_STATEMENTS.issue,BUYER_WRITER_LOCAL_STATEMENTS.cancel,BUYER_WRITER_LOCAL_STATEMENTS.reconcile])};
const signatures={runtime:['buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','buyer_writer.context(text,text,uuid,uuid,bigint)'],
  issuer:['buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)']};
const unavailable=()=>new Error('Buyer writer gateway database unavailable');

// This gateway-only identity proof intentionally observes, but does not force-pass,
// additive PUBLIC extension EXECUTE. The protected service is the isolation boundary.
// createBuyerWriterPostgres and its stronger pg_net-denial proof remain unchanged.
export const BUYER_WRITER_GATEWAY_IDENTITY_SQL=`select (
 session_user=$1 and current_user=$1
 and r.rolcanlogin and not(r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls or r.rolinherit)
 and not exists(select from pg_auth_members where member=r.oid)
 and exists(select from pg_roles where rolname='buyer_writer_owner' and not(rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit))
 and has_schema_privilege(current_user,'buyer_writer','USAGE')
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and coalesce((select bool_and(coalesce(has_function_privilege(current_user,to_regprocedure(s),'EXECUTE'),false)) from unnest($2::text[]) s),false)
 and not exists(select from unnest($2::text[]) s left join pg_proc p on p.oid=to_regprocedure(s)
   where p.oid is null or p.proowner<>(select oid from pg_roles where rolname='buyer_writer_owner') or not p.prosecdef
   or not coalesce(p.proconfig @> array['search_path=pg_catalog'],false))
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='buyer_writer' and has_function_privilege(current_user,p.oid,'EXECUTE') and not(p.oid=any(array(select to_regprocedure(s)::oid from unnest($2::text[]) s))))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
    and c.relkind in('r','p') and a.grantee=0
    and a.privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute x on x.attrelid=c.oid
   cross join lateral aclexplode(x.attacl) a
   where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
    and c.relkind in('r','p') and x.attnum>0 and not x.attisdropped and x.attacl is not null and a.grantee=0
    and a.privilege_type in('SELECT','INSERT','UPDATE','REFERENCES'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege(current_user,n.oid,'USAGE')
   and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind='S' and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege(current_user,n.oid,'USAGE')
   and case when c.relkind='S' then has_sequence_privilege(current_user,c.oid,'SELECT,UPDATE,USAGE') else false end)
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname not in('pg_catalog','information_schema','buyer_writer','net')
   and p.prosecdef and p.prorettype<>'event_trigger'::regtype and has_schema_privilege(current_user,n.oid,'USAGE')
   and has_function_privilege(current_user,p.oid,'EXECUTE'))
 and current_setting('statement_timeout')='10s' and current_setting('lock_timeout')='5s' and current_setting('search_path')='pg_catalog'
) as safe from pg_roles r where r.rolname=$1`;

function config(value,kind){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['host','port','database','password','ca'].includes(k))
    ||typeof value.host!=='string'||value.host.length>253||!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host)||!Number.isInteger(value.port)||value.port<1||value.port>65535
    ||typeof value.database!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(value.database)||typeof value.password!=='string'||value.password.length<1||value.password.length>1024||value.password.includes('\0')
    ||(value.ca!==undefined&&(typeof value.ca!=='string'||value.ca.length>65536||!value.ca.includes('-----BEGIN CERTIFICATE-----'))))throw unavailable();
  return {host:value.host,port:value.port,database:value.database,password:value.password,user:`buyer_writer_${kind}`,
    ssl:{rejectUnauthorized:true,...(value.ca===undefined?{}:{ca:value.ca})},application_name:`blackspire-buyer-writer-gateway-${kind}`,client_encoding:'UTF8',
    options:'-c statement_timeout=10000 -c lock_timeout=5000 -c search_path=pg_catalog -c idle_in_transaction_session_timeout=10000',
    connectionTimeoutMillis:2000,query_timeout:11000,idleTimeoutMillis:10000,max:kind==='runtime'?4:2,maxUses:100,maxLifetimeSeconds:60};
}

export async function createBuyerWriterGatewayPostgres({runtime,issuer,Pool}){
  const configs={runtime:config(runtime,'runtime'),issuer:config(issuer,'issuer')};
  if(runtime.password===issuer.password||runtime.host.toLowerCase()!==issuer.host.toLowerCase()||runtime.port!==issuer.port||runtime.database!==issuer.database)throw unavailable();
  const pools={},clients=new Set();let closed=false,healthy=true;
  const close=async()=>{if(closed)return;closed=true;for(const destroy of clients)destroy();await Promise.allSettled(Object.values(pools).map(pool=>pool.end()));};
  const run=async(kind,text,values,probe=false)=>{
    if(closed||!healthy||(!probe&&(!allowed[kind].has(text)||!Array.isArray(values))))throw unavailable();
    let client,timer,expired=false,released=false;
    const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
    const destroy=()=>release(true);
    const deadline=performance.now()+14_000;
    try{return await Promise.race([(async()=>{client=await pools[kind].connect();if(expired||closed){destroy();throw unavailable();}clients.add(destroy);
      const identity=await client.query(BUYER_WRITER_GATEWAY_IDENTITY_SQL,[configs[kind].user,signatures[kind]]);
      if(expired||closed||performance.now()>=deadline||identity?.rows?.length!==1||identity.rows[0]?.safe!==true)throw unavailable();
      if(probe)return;const result=await client.query(text,values);if(expired||closed||performance.now()>=deadline)throw unavailable();return result;})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;destroy();reject(unavailable());},14_000);})]);}
    catch(error){destroy();const safe=unavailable();if(['42501','23505','22023','22P02','22003','22008','54000'].includes(error?.code))safe.code=error.code;throw safe;}
    finally{clearTimeout(timer);release(false);clients.delete(destroy);}
  };
  try{const DriverPool=Pool??(await import('pg')).Pool;for(const kind of ['runtime','issuer']){pools[kind]=new DriverPool(configs[kind]);pools[kind].on('error',()=>{healthy=false;});}
    await run('runtime',null,null,true);await run('issuer',null,null,true);
    return Object.freeze({runtimeQuery:(text,values)=>run('runtime',text,values),issuerQuery:(text,values)=>run('issuer',text,values),isHealthy:()=>!closed&&healthy,close});
  }catch{await close();throw unavailable();}
}
