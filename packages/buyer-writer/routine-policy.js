// Reviewed PostgreSQL routine bodies from sql/install.sql. Digests cover the
// exact pg_proc.prosrc bytes; language/config/privilege attributes are checked
// separately so CREATE OR REPLACE drift cannot retain admission accidentally.
const ROUTINE_METADATA=Object.freeze({
  'buyer_writer.lock_public_scope()':[[], 'boolean'],
  'buyer_writer.lock_scope()':[[], 'boolean'],
  'buyer_writer.criteria(jsonb)':[['j'],'jsonb'],
  'buyer_writer.valid_context(jsonb)':[['c'],'boolean'],
  'buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)':[['p_job','p_owner','p_workspace','p_digest','p_context','p_expected_criteria','p_expected_updated_at','p_request'],'jsonb'],
  'buyer_writer.cancel(uuid,uuid,text)':[ ['p_job','p_owner','p_workspace'],'void'],
  'buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)':[ ['p_job','p_owner','p_workspace','p_request','p_expected_updated_at'],'jsonb'],
  'buyer_writer.valid_sale(jsonb)':[ ['r'],'boolean'],
  'buyer_writer.eligible(jsonb,jsonb)':[ ['r','c'],'boolean'],
  'buyer_writer.commit_buyers(buyer_writer.dispatches)':[ ['d'],'integer'],
  'buyer_writer.apply(text,text,jsonb)':[ ['p_digest','p_workspace','q'],'jsonb'],
  'buyer_writer.context(text,text,uuid,uuid,bigint)':[ ['p_digest','p_workspace','p_job','p_dispatch','p_generation'],'jsonb'],
  'buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)':[ ['p_digest','p_workspace','p_job','p_dispatch','p_generation','p_operation','p_index'],'jsonb'],
  'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_expires_at'],'boolean'],
  'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_permit_digest','q'],'jsonb'],
  'buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_job','p_permit_digest','p_context','p_expected_criteria','p_expected_updated_at','p_dispatch_request'],'jsonb'],
  'buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_job'],'jsonb'],
  'buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_job','p_dispatch_request','p_expected_updated_at'],'jsonb'],
  'buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_permit_digest','p_job','p_dispatch','p_generation','p_business_operation','p_chunk_index'],'jsonb'],
  'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace'],'jsonb'],
  'buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)':[ ['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_original_issuer','p_original_jti','p_original_request','p_original_digest','p_route_operation'],'jsonb'],
});
export const BUYER_WRITER_ROUTINES=Object.freeze([
  ['buyer_writer.lock_public_scope()','8653f179e4814e4c73f6c337017ec6d8faa237ec5fe149e5307aebbc31c6d911','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v','creator'],
  ['buyer_writer.lock_scope()','8c3f7564d40b5746db81e0dac735cf845a0fbeaeebb288c03120da9e9b82fc4f','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.criteria(jsonb)','578a1b4f9820b4380f3b8f2e18a4a9b85d5ad60f0ced1284a9641d1c907e5919','sql',false,['search_path=pg_catalog'],'i'],
  ['buyer_writer.valid_context(jsonb)','a95cf4477dccce9adca8c52d057cfac50552a4c5be08be00e97f107858d4a7a3','plpgsql',false,['search_path=pg_catalog'],'i'],
  ['buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','929b93c1d6b48c1ba5078af0881a2aabe515ac633c4bc40f3bfb017c03e7d78e','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.cancel(uuid,uuid,text)','8b67a388bad04646f19977170d209f76ef0d86ace9f351d4599c5ec92ccdd71f','plpgsql',true,['search_path=pg_catalog'],'v'],
  ['buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)','1c9edca5057194a129e23431ccf0c2d02f296a612e3dd4b9f54f9b1807c9adbe','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.valid_sale(jsonb)','e478ccb56ce5c121a895268c6f44caa7d3cf535306f8f22dd0db92e4fd98f4dd','plpgsql',false,['search_path=pg_catalog'],'i'],
  ['buyer_writer.eligible(jsonb,jsonb)','3c15ee24e7c2a31adbfe8d39c737ad9560ef09c97c2f6786b848190be245fc05','sql',false,['search_path=pg_catalog'],'i'],
  ['buyer_writer.commit_buyers(buyer_writer.dispatches)','503f8027fdb2992a466e8271467165a94b3b2b2ed96ff8507c59663cda6ae496','plpgsql',false,['search_path=pg_catalog'],'v'],
  ['buyer_writer.apply(text,text,jsonb)','784c971700b19f0e2262f67d1e6fc1991079237d2631466f5c823a0b2338fd3c','plpgsql',true,['search_path=pg_catalog','TimeZone=UTC','lock_timeout=5s'],'v'],
  ['buyer_writer.context(text,text,uuid,uuid,bigint)','44afc911defb0d273553fd78ab06960506257863b4ed392827b98cf689914ff2','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','3a5f587c8b6ff018ab6d5e91b339fc60b479d0250ea0a74c7d06935035e593de','plpgsql',true,['search_path=pg_catalog'],'v'],
  ['buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','a705d6a8fb84fd22ae424aaa6c19b36cc71692be54d7abdfe655ad379a1064ca','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','947472a925825b1628f38a0d3b232da6ac62414727c653fe047dffc3dafeb6cc','plpgsql',true,['search_path=pg_catalog','TimeZone=UTC','lock_timeout=5s'],'v'],
  ['buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','76701c67f63bd8ffc04ca012431994f3d4086707500369803039543e6f45f41d','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','ae1fdc1c4baa85f264d43dc58a8e3db731b58c0811ea51cc6c3756979975a854','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','e6e4e51af093ae9f191c1f5d4569a1c044d2f364200fe72200634d44f3e0f32f','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)','b6cf6d1de315b436687ab02ee32ceef221429973a00c76293ff602d8677c4a8b','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','9fbeb13300e17490f7a648a8e0171f03bc9da8cc6b5ad6dd675792342664398b','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
  ['buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)','6b70b51835dd1739c7842c3f28e4c1e221c79ebe83f08ed5a05c9a5d3c7a0c9d','plpgsql',true,['search_path=pg_catalog','lock_timeout=5s'],'v'],
].map(([signature,digest,language,securityDefiner,config,volatility,owner='writer'])=>{
  const [arguments_,result]=ROUTINE_METADATA[signature]??[];
  if(!arguments_||!result)throw new Error('Buyer Writer routine metadata missing');
  return Object.freeze({signature,digest,language,securityDefiner,config:Object.freeze(config),volatility,owner,
    arguments:Object.freeze(arguments_),result});
}));

export const BUYER_WRITER_ENTRYPOINTS=Object.freeze({
  runtime:Object.freeze(['buyer_writer.lock_scope()','buyer_writer.context(text,text,uuid,uuid,bigint)']),
  issuer:Object.freeze(['buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)']),
  admission:Object.freeze(['buyer_writer.lock_scope()','buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)','buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)']),
});
