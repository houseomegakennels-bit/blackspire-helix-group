import {BUYER_WRITER_ENTRYPOINTS,BUYER_WRITER_ROUTINES} from './routine-policy.js';

// Explicit credentials only. No environment, credential file, database URL or
// listener is loaded here. Deployment must supply the locked PostgreSQL driver.
const statements = {
  runtime: new Set([
    'select buyer_writer.apply($1,$2,$3::jsonb) as result',
    'select buyer_writer.receipt($1,$2,$3,$4,$5,$6,$7) as result',
    'select buyer_writer.context($1,$2,$3,$4,$5) as result',
  ]),
  issuer: new Set([
    'select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result',
    'select buyer_writer.reconcile($1,$2,$3,$4,$5::timestamptz) as result',
  ]),
};
const signatures = BUYER_WRITER_ENTRYPOINTS;
const routinePolicy=JSON.stringify(BUYER_WRITER_ROUTINES);
const unavailable = () => new Error('Buyer writer database unavailable');

// ACLs inherited from PUBLIC or another role count whenever their schema is
// reachable. Unreachable provider-owned defaults do not become writer authority.
export const WRITER_IDENTITY_SQL = `select (
 session_user=$1 and current_user=$1
 and r.rolcanlogin and not(r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls or r.rolinherit)
 and (select count(*) from pg_auth_members m join pg_roles role on role.oid=m.roleid
   where role.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')) between 3 and 4
 and (select count(distinct role.rolname) from pg_auth_members m join pg_roles role on role.oid=m.roleid
   where role.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') and m.admin_option and not m.inherit_option
   and (role.rolname='buyer_writer_owner' or not m.set_option) and m.grantor=10
   and coalesce((select rolsuper from pg_roles where oid=10),false))=3
 and exists(select from pg_auth_members m join pg_roles role on role.oid=m.roleid join pg_roles member on member.oid=m.member
   where role.rolname='buyer_writer_owner' and member.rolname='postgres'
   and member.oid=$4::oid and member.oid=(select datdba from pg_database where datname=current_database())
   and obj_description('buyer_writer'::regnamespace,'pg_namespace')='blackspire-buyer-writer:v1:creator-oid='||member.oid::text
   and not m.inherit_option and m.set_option)
 and not exists(select from pg_auth_members m join pg_roles role on role.oid=m.roleid join pg_roles member on member.oid=m.member
   where role.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')
   and not(member.rolname='postgres' and member.oid=$4::oid and member.oid=(select datdba from pg_database where datname=current_database()) and not m.inherit_option and (
    (m.admin_option and not m.set_option and m.grantor=10 and coalesce((select rolsuper from pg_roles where oid=10),false))
    or (role.rolname='buyer_writer_owner' and m.set_option and pg_get_userbyid(m.grantor)='postgres'))))
 and not exists(select from pg_auth_members m join pg_roles member on member.oid=m.member
   where member.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))
 and exists(select from pg_roles where rolname='buyer_writer_owner' and not(rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit))
 and has_schema_privilege(current_user,'buyer_writer','USAGE')
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and not exists(select from pg_database d cross join (values('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
   where d.datname<>current_database() and d.datallowconn and has_database_privilege(w.role_name,d.oid,'CONNECT'))
 and not exists(select from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where not t.tgisinternal and (n.nspname,c.relname) in(
    ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
    ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales')))
 and coalesce((select bool_and(coalesce(has_function_privilege(current_user,to_regprocedure(s),'EXECUTE'),false)) from unnest($2::text[]) s),false)
 and not exists(select from jsonb_to_recordset($3::jsonb) expected(signature text,digest text,language text,"securityDefiner" boolean,config text[],volatility text,owner text)
   left join pg_proc p on p.oid=to_regprocedure(expected.signature) left join pg_language l on l.oid=p.prolang
   where p.oid is null or p.proowner<>case when expected.owner='creator' then $4::oid else (select oid from pg_roles where rolname='buyer_writer_owner') end
   or p.prosecdef is distinct from expected."securityDefiner" or l.lanname is distinct from expected.language
   or encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from expected.digest
   or p.proconfig is distinct from expected.config or p.provolatile::text is distinct from expected.volatility
   or p.prokind<>'f' or p.proisstrict or p.proleakproof or p.proparallel<>'u')
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege(current_user,n.oid,'USAGE')
   and case when c.relkind in('r','p','v','m','f') then
    has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') else false end)
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege(current_user,n.oid,'USAGE')
   and case when c.relkind='S' then has_sequence_privilege(current_user,c.oid,'SELECT,UPDATE,USAGE') else false end)
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   cross join (values(current_user),('buyer_writer_owner')) w(role_name)
   where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_temp'
   and p.prorettype<>'event_trigger'::regtype
   and has_schema_privilege(w.role_name,n.oid,'USAGE')
   and has_function_privilege(w.role_name,p.oid,'EXECUTE')
   and not(
    (w.role_name=current_user and p.oid=any(array(select to_regprocedure(s)::oid from unnest($2::text[]) s)))
    or (w.role_name='buyer_writer_owner' and p.oid=any(array(select to_regprocedure(expected.signature)::oid
      from jsonb_to_recordset($3::jsonb) expected(signature text))))))
 and current_setting('statement_timeout')='10s' and current_setting('lock_timeout')='5s'
 and current_setting('search_path')='pg_catalog'
) as safe from pg_roles r where r.rolname=$1`;

const fenceSql=`with checked as materialized (${WRITER_IDENTITY_SQL})
select checked.safe,case when checked.safe then buyer_writer.lock_scope() else false end as locked from checked`;
const operationSql=text=>{
  const shifted=text.replaceAll(/\$(\d+)/g,(_,n)=>`$${Number(n)+4}`);
  return `with checked as materialized (${WRITER_IDENTITY_SQL})
select checked.safe,case when checked.safe then operation.result end as result
from checked cross join lateral (${shifted}) operation`;
};

function configuration(value,kind) {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).some(k=>!['host','port','database','password','ca'].includes(k))
    ||typeof value.host!=='string'||value.host.length>253||!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host)
    ||!Number.isInteger(value.port)||value.port<1||value.port>65535
    ||typeof value.database!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(value.database)
    ||typeof value.password!=='string'||value.password.length<1||value.password.length>1024||value.password.includes('\0')
    ||(value.ca!==undefined&&(typeof value.ca!=='string'||value.ca.length>65536||!value.ca.includes('-----BEGIN CERTIFICATE-----'))))throw unavailable();
  return {
    host:value.host,port:value.port,database:value.database,password:value.password,
    user:`buyer_writer_${kind}`,ssl:{rejectUnauthorized:true,...(value.ca===undefined?{}:{ca:value.ca})},
    application_name:`blackspire-buyer-writer-${kind}`,client_encoding:'UTF8',
    options:'-c statement_timeout=10000 -c lock_timeout=5000 -c search_path=pg_catalog -c idle_in_transaction_session_timeout=10000',
    connectionTimeoutMillis:2000,query_timeout:11000,idleTimeoutMillis:10000,
    max:kind==='runtime'?4:2,maxUses:100,maxLifetimeSeconds:60,
  };
}

export async function createBuyerWriterPostgres({runtime,issuer,creatorOid,Pool}) {
  const configs={runtime:configuration(runtime,'runtime'),issuer:configuration(issuer,'issuer')};
  if(!Number.isInteger(creatorOid)||creatorOid<1||creatorOid>4294967295
    ||runtime.password===issuer.password||runtime.host.toLowerCase()!==issuer.host.toLowerCase()
    ||runtime.port!==issuer.port||runtime.database!==issuer.database)throw unavailable();
  const pools={};const counts={runtime:0,issuer:0};const clients=new Set();
  let closed=false,healthy=true,closing;
  const close=()=>{
    if(closing)return closing;
    closed=true;
    // Every checked-out connection is explicitly owned by this component.
    for(const destroy of clients)destroy();
    let timer;
    closing=Promise.race([
      Promise.allSettled(Object.values(pools).map(pool=>Promise.resolve().then(()=>pool.end()))).then(results=>{
        if(results.some(r=>r.status==='rejected'))throw unavailable();
      }),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),2000);}),
    ]).finally(()=>clearTimeout(timer));
    return closing;
  };
  const run=async(kind,text,values,probe=false)=>{
    if(closed||!healthy||counts[kind]>=configs[kind].max||(!probe&&(!statements[kind].has(text)||!Array.isArray(values))))throw unavailable();
    counts[kind]++;
    let client,released=false,timer,expired=false,inTransaction=false;
    const release=destroy=>{
      if(!client||released)return;
      released=true;client.release(destroy);
    };
    const destroy=()=>release(true);
    const deadline=performance.now()+14000;
    try {
      return await Promise.race([
        (async()=>{
          client=await pools[kind].connect();
          if(expired||closed){release(true);throw unavailable();}
          clients.add(destroy);
          const identityValues=[configs[kind].user,signatures[kind],routinePolicy,creatorOid];
          if(probe){
            const result=await client.query(WRITER_IDENTITY_SQL,identityValues);
            if(expired||closed||performance.now()>=deadline||result?.rows?.length!==1||result.rows[0]?.safe!==true)throw unavailable();
            return;
          }
          await client.query('begin');inTransaction=true;
          const fenced=await client.query(fenceSql,identityValues);
          if(expired||closed||performance.now()>=deadline||fenced?.rows?.length!==1||fenced.rows[0]?.safe!==true||fenced.rows[0]?.locked!==true)throw unavailable();
          const written=await client.query(operationSql(text),[...identityValues,...values]);
          if(expired||closed||performance.now()>=deadline||written?.rows?.length!==1||written.rows[0]?.safe!==true)throw unavailable();
          await client.query('commit');inTransaction=false;
          if(expired||closed||performance.now()>=deadline)throw unavailable();
          return written;
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;destroy();reject(unavailable());},14000);}),
      ]);
    }catch(error){
      if(inTransaction&&!released)try{await client.query('rollback');}catch{}
      destroy();const safe=unavailable();
      if(['42501','23505','22023','22P02','22003','22008','54000'].includes(error?.code))safe.code=error.code;
      throw safe;
    }finally{
      clearTimeout(timer);release(false);clients.delete(destroy);counts[kind]--;
    }
  };
  try {
    const DriverPool=Pool??(await import('pg')).Pool;
    for(const kind of ['runtime','issuer']) {
      pools[kind]=new DriverPool(configs[kind]);
      pools[kind].on('error',()=>{healthy=false;});
    }
    await run('runtime',null,null,true);await run('issuer',null,null,true);
    return Object.freeze({runtimeQuery:(text,values)=>run('runtime',text,values),issuerQuery:(text,values)=>run('issuer',text,values),isHealthy:()=>!closed&&healthy,close});
  }catch{
    await close();throw unavailable();
  }
}
