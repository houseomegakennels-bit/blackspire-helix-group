import {createBuyerWriterPostgres,WRITER_IDENTITY_SQL} from './postgres.js';

// The isolated gateway and disposable direct transport intentionally share one
// catalog predicate and transaction fence. Keeping a second gateway-specific
// copy previously allowed the production path to drift behind reviewed role,
// routine, relation, trigger, rule and privilege checks.
export const BUYER_WRITER_GATEWAY_IDENTITY_SQL=WRITER_IDENTITY_SQL;

export function createBuyerWriterGatewayPostgres(options){
  return createBuyerWriterPostgres(options);
}
