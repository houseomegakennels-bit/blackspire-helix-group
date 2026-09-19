-- Nexus capability reads run with the service role through the internal,
-- token-authenticated, exact-workspace endpoint. Browser roles must not have
-- direct access to raw contact PII or provider responses.
drop policy if exists "nexus_contacts_authenticated_all" on public.nexus_contacts;

revoke all privileges on table public.nexus_contacts from anon;
revoke all privileges on table public.nexus_contacts from authenticated;
