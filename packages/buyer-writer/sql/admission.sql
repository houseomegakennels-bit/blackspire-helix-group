-- Same-database authorization admission and receipt-correlation layer.
-- Install only after the canonical buyer_writer installer.
set local role buyer_writer_owner;

create table if not exists buyer_writer.operation_admissions (
 issuer text not null,
 jti uuid not null,
 request_id uuid not null,
 raw_body_digest text not null check(raw_body_digest ~ '^[a-f0-9]{64}$'),
 subject uuid,
 release_sha text check(release_sha is null or release_sha ~ '^[a-f0-9]{40}$'),
 operation_id uuid,
 attempt_id uuid,
 workspace text check(workspace is null or length(workspace) between 1 and 128),
 route_operation text check(route_operation is null or route_operation in ('apply','issue','cancel','reconcile','receipt')),
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
 check((state='reserved' and subject is null and release_sha is null
     and operation_id is null and attempt_id is null and workspace is null
     and route_operation is null and result is null and completed_at is null)
    or (state<>'reserved' and subject is not null and release_sha is not null
     and operation_id is not null and attempt_id is not null and workspace is not null
     and route_operation is not null and result is not null and completed_at is not null))
);
alter table buyer_writer.operation_admissions drop constraint if exists operation_admissions_route_operation_check;
alter table buyer_writer.operation_admissions add constraint operation_admissions_route_operation_check
 check(route_operation is null or route_operation in ('apply','issue','cancel','reconcile','receipt'));
create or replace function buyer_writer.reserve_operation(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,
 p_expires_at timestamptz
) returns boolean language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare changed integer;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200
  or p_jti is null or p_request is null
  or p_raw_digest is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_expires_at<=clock_timestamp() or not isfinite(p_expires_at) then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 insert into buyer_writer.operation_admissions(
  issuer,jti,request_id,raw_body_digest,expires_at)
 values(p_issuer,p_jti,p_request,p_raw_digest,p_expires_at)
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
  or p_issuer is null or length(p_issuer) not between 1 and 200
  or p_jti is null or p_request is null or p_subject is null
  or p_raw_digest is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release is null or p_release !~ '^[a-f0-9]{40}$'
  or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_permit_digest is null or p_permit_digest !~ '^[a-f0-9]{64}$' then
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
 if not found or a.state<>'reserved'
  or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest
  or a.subject is not null or a.release_sha is not null
  or a.operation_id is not null or a.attempt_id is not null
  or a.workspace is not null or a.route_operation is not null
  or a.expires_at<=clock_timestamp()
  or j.user_id is distinct from p_subject
  or d.workspace is distinct from p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 op:=q->>'operation';idx:=(q->>'chunkIndex')::integer;
 db_digest:=encode(sha256(convert_to(q::text,'UTF8')),'hex');
 v_result:=buyer_writer.apply(p_permit_digest,p_workspace,q);
 update buyer_writer.operation_admissions set
  state=case when v_result->'ok'='true'::jsonb then 'succeeded' else 'business_failed' end,
  subject=p_subject,release_sha=p_release,operation_id=p_operation_id,
  attempt_id=p_attempt_id,workspace=p_workspace,route_operation='apply',
  job_id=j.id,dispatch_id=d.id,generation=d.generation,
  business_operation=op,chunk_index=idx,request_digest=db_digest,
  result=v_result,completed_at=clock_timestamp()
 where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_issue(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_job uuid,p_permit_digest text,p_context jsonb,p_expected_criteria jsonb,
 p_expected_updated_at timestamptz,p_dispatch_request uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128 or p_job is null
  or p_permit_digest !~ '^[a-f0-9]{64}$' or p_dispatch_request is null
  or p_operation_id<>p_dispatch_request then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_subject then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 v_result:=buyer_writer.issue(p_job,p_subject,p_workspace,p_permit_digest,p_context,p_expected_criteria,p_expected_updated_at,p_dispatch_request);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='issue',
  job_id=p_job,dispatch_id=(v_result->>'dispatchId')::uuid,generation=(v_result->>'generation')::bigint,
  result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_cancel(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,p_job uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128 or p_job is null then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_subject then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 perform buyer_writer.cancel(p_job,p_subject,p_workspace);
 v_result:=jsonb_build_object('cancelled',true,'jobId',p_job);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='cancel',
  job_id=p_job,result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_reconcile(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_job uuid,p_dispatch_request uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;d buyer_writer.dispatches;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128 or p_job is null
  or p_dispatch_request is null or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at)) then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_subject then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into d from buyer_writer.dispatches where id=p_dispatch_request for update;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 v_result:=buyer_writer.reconcile(p_job,p_subject,p_workspace,p_dispatch_request,p_expected_updated_at);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='reconcile',
  job_id=p_job,dispatch_id=p_dispatch_request,generation=nullif(v_result->>'generation','')::bigint,
  result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_receipt(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_permit_digest text,p_job uuid,p_dispatch uuid,p_generation bigint,
 p_business_operation text,p_chunk_index integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;d buyer_writer.dispatches;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_permit_digest !~ '^[a-f0-9]{64}$' or p_job is null or p_dispatch is null
  or p_generation is null or p_business_operation is null or length(p_business_operation) not between 1 and 32
  or p_chunk_index is null or p_chunk_index<0 then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 select * into d from buyer_writer.dispatches where id=p_dispatch and job_id=p_job for update;
 if j.user_id is distinct from p_subject or d.id is null or d.workspace is distinct from p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 v_result:=buyer_writer.receipt(p_permit_digest,p_workspace,p_job,p_dispatch,p_generation,p_business_operation,p_chunk_index);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='receipt',
  job_id=p_job,dispatch_id=p_dispatch,generation=p_generation,business_operation=p_business_operation,
  chunk_index=p_chunk_index,result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
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
 if not found or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 if a.state='reserved' then
  return jsonb_build_object('state','reserved','automaticRetry',false);
 end if;
 if a.subject is distinct from p_subject or a.release_sha is distinct from p_release
  or a.operation_id is distinct from p_operation_id
  or a.attempt_id is distinct from p_attempt_id
  or a.workspace is distinct from p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 -- Reacquire in canonical order before trusting persisted correlation.
 select id,user_id into j from public."SearchJob" where id=a.job_id for update;
 select * into d from buyer_writer.dispatches
  where id=a.dispatch_id and job_id=a.job_id for update;
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if j.user_id is distinct from p_subject
  or (a.route_operation in ('apply','issue','receipt') and d.id is null)
  or (d.id is not null and d.workspace is distinct from p_workspace) then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 if a.route_operation='apply' then
  select request_digest,result into r from buyer_writer.receipts
   where dispatch_id=a.dispatch_id and operation=a.business_operation
    and chunk_index=a.chunk_index;
  if not found or r.request_digest is distinct from a.request_digest
   or r.result is distinct from a.result then
   return jsonb_build_object('state','inconsistent','automaticRetry',false);
  end if;
 elsif a.route_operation='issue' then
  if d.id is null or d.generation is distinct from a.generation
   or a.result is distinct from jsonb_build_object('dispatchId',d.id,'generation',d.generation) then
   return jsonb_build_object('state','inconsistent','automaticRetry',false);
  end if;
 elsif a.route_operation not in ('cancel','reconcile','receipt') then
  return jsonb_build_object('state','inconsistent','automaticRetry',false);
 end if;
 return jsonb_build_object('state',a.state,'routeOperation',a.route_operation,
  'result',a.result,'automaticRetry',false,'requestCorrelated',true);
end$$;

create or replace function buyer_writer.recover_admission(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_original_issuer text,p_original_jti uuid,p_original_request uuid,
 p_original_digest text,p_route_operation text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare recovery buyer_writer.operation_admissions;
 original buyer_writer.operation_admissions; correlation jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_original_issuer is null or length(p_original_issuer) not between 1 and 200
  or p_original_jti is null or p_original_request is null
  or p_original_digest !~ '^[a-f0-9]{64}$'
  or p_route_operation not in('apply','issue','cancel','reconcile','receipt') then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select * into recovery from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti;
 if not found or recovery.state<>'reserved'
  or recovery.request_id is distinct from p_request
  or recovery.raw_body_digest is distinct from p_raw_digest
  or recovery.subject is not null or recovery.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into original from buyer_writer.operation_admissions
  where issuer=p_original_issuer and jti=p_original_jti;
 if not found or original.request_id is distinct from p_original_request
  or original.raw_body_digest is distinct from p_original_digest
  or original.subject is distinct from p_subject
  or original.release_sha is distinct from p_release
  or original.operation_id is distinct from p_operation_id
  or original.attempt_id is distinct from p_attempt_id
  or original.workspace is distinct from p_workspace
  or original.route_operation is distinct from p_route_operation
  or original.state not in('succeeded','business_failed') then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 correlation:=buyer_writer.correlate_admission(
  p_original_issuer,p_original_jti,p_original_request,p_original_digest,p_subject,
  p_release,p_operation_id,p_attempt_id,p_workspace);
 if correlation->>'state' not in('succeeded','business_failed')
  or correlation->>'routeOperation' is distinct from p_route_operation
  or correlation->'requestCorrelated' is distinct from 'true'::jsonb then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into original from buyer_writer.operation_admissions
  where issuer=p_original_issuer and jti=p_original_jti;
 select * into recovery from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if recovery.state<>'reserved' or recovery.request_id is distinct from p_request
  or recovery.raw_body_digest is distinct from p_raw_digest
  or recovery.subject is not null or recovery.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 update buyer_writer.operation_admissions set
  state=original.state,subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,
  route_operation=p_route_operation,job_id=original.job_id,
  dispatch_id=original.dispatch_id,generation=original.generation,
  business_operation=original.business_operation,chunk_index=original.chunk_index,
  request_digest=original.request_digest,result=original.result,
  completed_at=clock_timestamp()
 where issuer=p_issuer and jti=p_jti;
 return correlation;
end$$;

revoke all on table buyer_writer.operation_admissions from public;
revoke all on function buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz,uuid) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamptz) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text) from public,buyer_writer_runtime,buyer_writer_issuer;
revoke all on function buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text) from public,buyer_writer_runtime,buyer_writer_issuer;
grant execute on function buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz),
 buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb),
 buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz,uuid),
 buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid),
 buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamptz),
 buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer),
 buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text),
 buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text) to buyer_writer_admission;
