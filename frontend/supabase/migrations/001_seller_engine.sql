create extension if not exists "pgcrypto";

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  county text,
  state text not null default 'NC',
  source_type text not null,
  source_url text,
  integration_type text not null default 'manual_csv',
  configuration jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  last_imported_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  property_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.owners(id) on delete set null,
  data_source_id uuid references public.data_sources(id) on delete set null,
  property_address text not null,
  parcel_id text,
  county text,
  city text,
  state text not null default 'NC',
  zip_code text,
  property_type text,
  assessed_value numeric,
  last_sale_date date,
  last_sale_price numeric,
  owner_occupancy_status text,
  tax_delinquent boolean not null default false,
  foreclosure boolean not null default false,
  probate boolean not null default false,
  vacant boolean not null default false,
  code_violation boolean not null default false,
  years_owned integer,
  estimated_equity numeric,
  imported_at timestamptz not null default now(),
  raw_source_data jsonb not null default '{}'::jsonb,
  unique(county, parcel_id)
);

create table if not exists public.seller_scoring_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Default',
  weights jsonb not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete set null,
  status text not null default 'New',
  motivation_score integer not null default 0 check (motivation_score between 0 and 100),
  lead_category text not null default 'Low Priority',
  motivation_reasons jsonb not null default '[]'::jsonb,
  recommended_action text,
  ai_summary text,
  duplicate_of uuid references public.seller_leads(id) on delete set null,
  sent_to_deal_engine_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id)
);

create table if not exists public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid not null references public.seller_leads(id) on delete cascade,
  score integer not null,
  category text not null,
  reasons jsonb not null default '[]'::jsonb,
  weights_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid not null references public.seller_leads(id) on delete cascade,
  note text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid not null references public.seller_leads(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.seller_alerts (
  id uuid primary key default gen_random_uuid(),
  seller_lead_id uuid references public.seller_leads(id) on delete cascade,
  alert_type text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  email_template jsonb,
  created_at timestamptz not null default now()
);

create index if not exists seller_leads_score_idx on public.seller_leads(motivation_score desc);
create index if not exists seller_leads_status_idx on public.seller_leads(status);
create index if not exists properties_county_city_idx on public.properties(county, city);
create index if not exists properties_distress_idx on public.properties(foreclosure, probate, tax_delinquent);

alter table public.data_sources enable row level security;
alter table public.owners enable row level security;
alter table public.properties enable row level security;
alter table public.seller_leads enable row level security;
alter table public.lead_scores enable row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_status_history enable row level security;
alter table public.seller_alerts enable row level security;
alter table public.seller_scoring_settings enable row level security;

