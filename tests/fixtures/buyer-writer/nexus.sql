-- Canonical Nexus contact shape; synthetic seller FK fixture, no production data.
create table public.seller_leads(id uuid primary key);
create table if not exists public.nexus_contacts (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid references public.seller_leads(id) on delete cascade,
  owner_name text not null,
  property_address text not null,
  mailing_address text,
  primary_phone text,
  secondary_phone text,
  additional_phones jsonb not null default '[]'::jsonb,
  primary_email text,
  additional_emails jsonb not null default '[]'::jsonb,
  contact_confidence_score integer,
  phone_confidence integer,
  email_confidence integer,
  dnc_flag boolean,
  provider text,
  provider_record_id text,
  raw_response jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.nexus_contacts enable row level security;
create policy nexus_contacts_authenticated_all on public.nexus_contacts for all to authenticated using(true) with check(true);
grant all on public.nexus_contacts to anon,authenticated,service_role;
insert into public.nexus_contacts(owner_name,property_address,status,raw_response) values
 ('ISOLATED ONE','SYNTHETIC ONE','completed','{"synthetic":1}'),
 ('ISOLATED TWO','SYNTHETIC TWO','queued','{"synthetic":2}');
