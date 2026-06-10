-- nexus_contacts was read/written by nexus-server, deal-engine-server, and tracerfy
-- but never created — so every skip-trace contact write silently failed and phone/
-- email were never persisted anywhere queryable. Creating it activates the existing
-- write path and makes phone/email/owner globally searchable.

create table if not exists public.nexus_contacts (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid,
  owner_name text,
  property_address text,
  mailing_address text,
  primary_phone text,
  secondary_phone text,
  additional_phones jsonb default '[]'::jsonb,
  primary_email text,
  additional_emails jsonb default '[]'::jsonb,
  contact_confidence_score numeric,
  phone_confidence numeric,
  email_confidence numeric,
  dnc_flag boolean,
  provider text,
  provider_record_id text,
  raw_response jsonb,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- Normalized digits-only phone so "9105550123" matches a stored "910-555-0123".
alter table public.nexus_contacts
  add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(primary_phone,'') || coalesce(secondary_phone,''), '\D', '', 'g')) stored;

create index if not exists nexus_contacts_seller_lead_idx on public.nexus_contacts (seller_lead_id);
create index if not exists nexus_contacts_phone_idx on public.nexus_contacts (primary_phone);
create index if not exists nexus_contacts_phone_digits_idx on public.nexus_contacts (phone_digits);
create index if not exists nexus_contacts_email_idx on public.nexus_contacts (primary_email);

alter table public.nexus_contacts enable row level security;
drop policy if exists "nexus_contacts_authenticated_all" on public.nexus_contacts;
create policy "nexus_contacts_authenticated_all" on public.nexus_contacts
  for all to authenticated using (true) with check (true);
