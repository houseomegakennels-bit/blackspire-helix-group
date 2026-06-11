alter table public.harvester_buyer_matches
  add column if not exists buyer_report_id text,
  add column if not exists buyer_search_job_id text,
  add column if not exists mailing_address text,
  add column if not exists purchase_count integer,
  add column if not exists total_spend numeric(14,2),
  add column if not exists is_llc boolean default false,
  add column if not exists is_cash_buyer boolean default false,
  add column if not exists skip_trace_status text,
  add column if not exists primary_phone text,
  add column if not exists primary_email text,
  add column if not exists contact_confidence_score numeric(5,2),
  add column if not exists contact_provider text,
  add column if not exists last_contact_refresh_at timestamptz,
  add column if not exists buyer_workspace_href text,
  add column if not exists nexus_contact_href text;

create index if not exists harvester_buyer_matches_buyer_report_idx on public.harvester_buyer_matches (buyer_report_id);
create index if not exists harvester_buyer_matches_buyer_search_job_idx on public.harvester_buyer_matches (buyer_search_job_id);
create index if not exists harvester_buyer_matches_skip_trace_status_idx on public.harvester_buyer_matches (skip_trace_status);
