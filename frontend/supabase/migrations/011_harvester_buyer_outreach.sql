-- Persist the outreach message generated when an operator sends a Harvester
-- buyer match to a buyer (subject/body + status, so it's a record, not just text).
alter table public.harvester_buyer_matches
  add column if not exists outreach_status text,
  add column if not exists outreach_subject text,
  add column if not exists outreach_body text,
  add column if not exists outreach_prepared_at timestamptz;
