create table if not exists public.real_estate_engines (
  id text primary key,
  name text not null,
  slug text not null unique,
  tagline text not null,
  description text not null,
  color_scheme text not null,
  status text not null default 'live',
  ecosystem_path text not null,
  workspace_path text not null,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.real_estate_engines (
  id, name, slug, tagline, description, color_scheme, status, ecosystem_path, workspace_path, logo_path
)
values
  ('seller-engine', 'Blackspire Seller Engine', 'seller-engine', 'Find the Opportunity.', 'Finds motivated seller opportunities.', 'red/silver/black', 'live', '/real-estate-intelligence/seller-engine', '/workspaces/seller-engine', '/brand/blackspire-seller-engine-logo.png'),
  ('nexus', 'Blackspire Nexus', 'nexus', 'Find the Decision Maker.', 'Runs skip trace and resolves contact intelligence.', 'purple/silver/black', 'live', '/real-estate-intelligence/nexus', '/workspaces/nexus', '/brand/blackspire-nexus-logo.png'),
  ('deal-engine', 'Blackspire Deal Engine', 'deal-engine', 'Create the Opportunity.', 'Analyzes leads, manages acquisition, contracts, and buyer-ready deal packets.', 'teal/gold/silver/black', 'live', '/real-estate-intelligence/deal-engine', '/workspaces/deal-engine', '/brand/blackspire-deal-engine-logo.png'),
  ('buyer-engine', 'Blackspire Buyer Engine', 'buyer-engine', 'Create the Exit.', 'Matches deals to cash buyers and investors.', 'green/gold/black', 'live', '/real-estate-intelligence/buyer-engine', '/workspaces/buyer-engine', '/brand/blackspire-buyer-engine-logo.png')
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  tagline = excluded.tagline,
  description = excluded.description,
  color_scheme = excluded.color_scheme,
  status = excluded.status,
  ecosystem_path = excluded.ecosystem_path,
  workspace_path = excluded.workspace_path,
  logo_path = excluded.logo_path,
  updated_at = now();

alter table public.owners
  add column if not exists primary_phone text,
  add column if not exists secondary_phone text,
  add column if not exists additional_phones jsonb not null default '[]'::jsonb,
  add column if not exists primary_email text,
  add column if not exists additional_emails jsonb not null default '[]'::jsonb,
  add column if not exists contact_confidence_score integer,
  add column if not exists phone_confidence integer,
  add column if not exists email_confidence integer,
  add column if not exists dnc_flag boolean,
  add column if not exists skip_trace_status text,
  add column if not exists skip_trace_provider text,
  add column if not exists skip_trace_requested_at timestamptz,
  add column if not exists skip_trace_completed_at timestamptz,
  add column if not exists raw_skiptrace_response jsonb not null default '{}'::jsonb;

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

create table if not exists public.skip_trace_requests (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid references public.seller_leads(id) on delete cascade,
  provider text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  error_message text,
  credits_used integer not null default 0,
  requested_by text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.nexus_credit_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  credits_start integer not null default 0,
  credits_used integer not null default 0,
  credits_remaining integer not null default 0,
  source text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.real_estate_engines enable row level security;
alter table public.nexus_contacts enable row level security;
alter table public.skip_trace_requests enable row level security;
alter table public.nexus_credit_usage enable row level security;
