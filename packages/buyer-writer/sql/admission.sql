-- Same-database authorization admission and receipt-correlation layer.
-- Install only after the canonical buyer_writer installer.
set local role buyer_writer_owner;

create table if not exists buyer_writer.operation_admissions (
 issuer text not null,
 jti uuid not null,
 request_id uuid not null,
 raw_body_digest text not null check(raw_body_digest ~ '^[a-f0-9]{64}$'),
 subject uuid not null,
 release_sha text not null check(release_sha ~ '^[a-f0-9]{40}$'),
 operation_id uuid not null,
 attempt_id uuid not null,
 workspace text not null check(length(workspace) between 1 and 128),
 route_operation text not null check(route_operation in ('apply','receipt')),
 expires_at timestamptz not null,
 state text not null default 'reserved'
  check(state in ('reserved','succeeded','business_failed')),
 job_id uuid,
 dispatch_id uuid,
 generation bigint,
 business_operation text,
 chunk_index integer,
 request_digest text check(request_digest is null or request_digest ~ '^[a-f0-9]{64}$'),
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 primary key(issuer,jti),
 unique(issuer,request_id),
 check((state='reserved' and result is null and completed_at is null)
    or (state<>'reserved' and result is not null and completed_at is not null))
);
create or replace function buyer_writer.reserve_operation(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_route text,p_expires_at timestamptz
) returns boolean language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare changed integer;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200
  or p_jti is null or p_request is null or p_subject is null
  or p_raw_digest is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release is null or p_release !~ '^[a-f0-9]{40}$'
  or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_route not in ('apply','receipt') or p_expires_at<=clock_timestamp()
  or not isfinite(p_expires_at) then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 insert into buyer_writer.operation_admissions(
  issuer,jti,request_id,raw_body_digest,subject,release_sha,operation_id,
  attempt_id,workspace,route_operation,expires_at)
 values(p_issuer,p_jti,p_request,p_raw_digest,p_subject,p_release,p_operation_id,
  p_attempt_id,p_workspace,p_route,p_expires_at)
 on conflict do nothing;
 get diagnostics changed=row_count;
 return changed=1;
end$$;
create or replace function buyer_writer.execute_admitted_apply(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_permit_digest text,q jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set timezone='UTC' set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions; d buyer_writer.dispatches;
 j record; v_result jsonb; db_digest text; op text; idx integer;
begin
 if jsonb_typeof(q) is distinct from 'object'
  or not q ?& array['jobId','dispatchId','generation','operation','chunkIndex']
  or p_jti is null or p_request is null then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 -- Preserve the canonical lock order: SearchJob, dispatch, admission.
 select id,user_id into j from public."SearchJob"
  where id=(q->>'jobId')::uuid for update;
 if not found then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into d from buyer_writer.dispatches
  where id=(q->>'dispatchId')::uuid and job_id=j.id for update;
 if not found then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id<>p_request
  or a.raw_body_digest<>p_raw_digest or a.subject<>p_subject
  or a.release_sha<>p_release or a.operation_id<>p_operation_id
  or a.attempt_id<>p_attempt_id or a.workspace<>p_workspace
  or a.route_operation<>'apply' or a.expires_at<=clock_timestamp()
  or j.user_id is distinct from p_subject or d.workspace<>p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 op:=q->>'operation';idx:=(q->>'chunkIndex')::integer;
 db_digest:=encode(sha256(convert_to(q::text,'UTF8')),'hex');
 v_result:=buyer_writer.apply(p_permit_digest,p_workspace,q);
 update buyer_writer.operation_admissions set
  state=case when v_result->'ok'='true'::jsonb then 'succeeded' else 'business_failed' end,
  job_id=j.id,dispatch_id=d.id,generation=d.generation,
  business_operation=op,chunk_index=idx,request_digest=db_digest,
  result=v_result,completed_at=clock_timestamp()
 where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.correlate_admission(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions; j record; d buyer_writer.dispatches;
 r record;
begin
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti;
 if not found or a.request_id<>p_request or a.raw_body_digest<>p_raw_digest
  or a.subject<>p_subject or a.release_sha<>p_release
  or a.operation_id<>p_operation_id or a.attempt_id<>p_attempt_id
  or a.workspace<>p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 if a.state='reserved' then
  return jsonb_build_object('state','reserved','automaticRetry',false);
 end if;
 -- Reacquire in canonical order before trusting persisted correlation.
 select id,user_id into j from public."SearchJob" where id=a.job_id for update;
 select * into d from buyer_writer.dispatches
  where id=a.dispatch_id and job_id=a.job_id for update;
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if j.user_id is distinct from p_subject or d.id is null
  or d.workspace<>p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select request_digest,result into r from buyer_writer.receipts
  where dispatch_id=a.dispatch_id and operation=a.business_operation
   and chunk_index=a.chunk_index;
 if not found or r.request_digest is distinct from a.request_digest
  or r.result is distinct from a.result then
  return jsonb_build_object('state','inconsistent','automaticRetry',false);
 end if;
 return jsonb_build_object('state',a.state,'result',a.result,
  'automaticRetry',false,'requestCorrelated',true);
end$$;

revoke all on table buyer_writer.operation_admissions from public;
revoke all on function buyer_writer.reserve_operation(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,timestamptz) from public;
revoke all on function buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb) from public;
revoke all on function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text) from public;
grant execute on function buyer_writer.reserve_operation(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,timestamptz) to buyer_writer_runtime;
grant execute on function buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb) to buyer_writer_runtime;
grant execute on function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text) to buyer_writer_runtime;
