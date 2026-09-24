export const OWNED_RECEIPT_STORAGE_SQL=`SELECT c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
 AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.reloptions IS NULL
 AND n.nspowner=c.relowner AND NOT EXISTS(SELECT FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee<>n.nspowner)
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
 AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)
 AND NOT EXISTS(SELECT FROM pg_rewrite WHERE ev_class=c.oid)
 AND NOT EXISTS(SELECT FROM pg_inherits WHERE c.oid IN(inhparent,inhrelid))
 AND (SELECT count(*) FROM pg_constraint WHERE conrelid=c.oid)=1
 AND EXISTS(SELECT FROM pg_constraint WHERE conrelid=c.oid AND contype='p' AND convalidated AND NOT condeferrable AND NOT condeferred AND pg_get_constraintdef(oid)='PRIMARY KEY (operation_id)')
 AND (SELECT count(*) FROM pg_index WHERE indrelid=c.oid)=1
 AND EXISTS(SELECT FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_am am ON am.oid=ic.relam
 JOIN pg_opclass op ON op.oid=i.indclass[0] JOIN pg_namespace ons ON ons.oid=op.opcnamespace
 WHERE i.indrelid=c.oid AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indisexclusion
 AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey[0]=1 AND i.indexprs IS NULL AND i.indpred IS NULL AND i.indcollation[0]=0 AND i.indoption[0]=0
 AND am.amname='btree' AND ons.nspname='pg_catalog' AND op.opcname='uuid_ops' AND ic.reloptions IS NULL)
 AND NOT EXISTS(SELECT FROM pg_attrdef WHERE adrelid=c.oid)
 AND NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND (attisdropped OR attgenerated<>'' OR attidentity<>'' OR attacl IS NOT NULL OR attndims<>0 OR atttypmod<>-1 OR attcollation<>0))
 AND (SELECT count(*) FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)=2
 AND EXISTS(SELECT FROM pg_attribute WHERE attrelid=c.oid AND attname='operation_id' AND attnum=1 AND atttypid='uuid'::regtype AND attnotnull)
 AND EXISTS(SELECT FROM pg_attribute WHERE attrelid=c.oid AND attname='receipt' AND attnum=2 AND atttypid='jsonb'::regtype AND attnotnull)
 AS safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owned_buyer_migration' AND c.relname=$1`;
