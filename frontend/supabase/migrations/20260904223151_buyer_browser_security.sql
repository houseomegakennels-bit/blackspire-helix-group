-- Buyer data is served by authenticated, owner-scoped server routes and the
-- exact-workspace internal capability endpoints. Anonymous REST access must
-- not bypass those controls. Service-role grants are intentionally preserved.
-- Deploy only after checking the live n8n writer identity: an archived workflow
-- used anon credentials and must move to an authorized server identity first.
-- No rows or tables are removed; do not restore broad access on code rollback.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The live n8n workflow also inserts raw and normalized sales with anon.
-- Reconcile those writes with the authorized server identity before applying.
drop policy if exists "anon_insert_raw_sale" on public."RawSale";
revoke all privileges on table public."RawSale" from anon, authenticated;

drop policy if exists "anon_insert_clean_sale" on public."CleanSale";
revoke all privileges on table public."CleanSale" from anon, authenticated;

drop policy if exists "anon_insert_buyer_profile" on public."BuyerProfile";
drop policy if exists "anon_select_buyer_profile" on public."BuyerProfile";
drop policy if exists "anon_update_buyer_profile" on public."BuyerProfile";
drop policy if exists "authenticated_read_buyer_profiles" on public."BuyerProfile";
revoke all privileges on table public."BuyerProfile" from anon, authenticated;

drop policy if exists "anon_insert_buyer_report" on public."BuyerReport";
drop policy if exists "anon_select_buyer_report" on public."BuyerReport";
drop policy if exists "authenticated_read_buyer_reports" on public."BuyerReport";
revoke all privileges on table public."BuyerReport" from anon, authenticated;

drop policy if exists "anon_select_search_job" on public."SearchJob";
drop policy if exists "anon_update_search_job" on public."SearchJob";
revoke all privileges on table public."SearchJob" from anon;
-- Keep the existing authenticated user_read_own_search_jobs policy and grants.
