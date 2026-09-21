-- Installed by owned-cluster provisioning only, never against Supabase.
-- Login passwords are supplied by the protected host credential provisioner.
CREATE ROLE buyer_repository_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE buyer_repository_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE buyer_capability_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE buyer_capability_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT buyer_repository_user TO buyer_repository_login WITH INHERIT FALSE, SET TRUE;
GRANT buyer_capability_reader TO buyer_capability_login WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE postgres TO buyer_repository_login,buyer_capability_login;
GRANT USAGE ON SCHEMA public TO buyer_repository_user,buyer_capability_reader;
GRANT SELECT,INSERT ON public."SearchJob",public.exports TO buyer_repository_user;
GRANT SELECT ON public."BuyerReport",public."BuyerProfile" TO buyer_repository_user;
GRANT SELECT ON public."BuyerProfile" TO buyer_capability_reader;
ALTER TABLE public."SearchJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BuyerReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BuyerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY buyer_repository_jobs ON public."SearchJob" TO buyer_repository_user USING(user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
CREATE POLICY buyer_repository_reports ON public."BuyerReport" FOR SELECT TO buyer_repository_user USING(EXISTS(SELECT 1 FROM public."SearchJob" j WHERE j.id=search_job_id AND j.user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid));
CREATE POLICY buyer_repository_exports ON public.exports TO buyer_repository_user USING(user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid AND (search_job_id IS NULL OR EXISTS(SELECT 1 FROM public."SearchJob" j WHERE j.id=search_job_id AND j.user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid)));
CREATE POLICY buyer_repository_profiles ON public."BuyerProfile" FOR SELECT TO buyer_repository_user,buyer_capability_reader USING(true);
