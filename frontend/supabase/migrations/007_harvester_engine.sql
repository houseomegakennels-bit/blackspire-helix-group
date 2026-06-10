create extension if not exists "pgcrypto";

create table if not exists public.harvester_intakes (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_name text,
  source_url text,
  original_text text,
  original_file_url text,
  original_file_type text,
  extracted_text text,
  extraction_status text not null default 'pending',
  extraction_confidence numeric(5,2) not null default 0,
  classification text,
  created_seller_lead_id uuid references public.seller_leads(id) on delete set null,
  created_deal_id text references public.deal_leads(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.harvester_extracted_opportunities (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.harvester_intakes(id) on delete cascade,
  address text,
  city text,
  state text,
  zip text,
  county text,
  asking_price numeric(12,2),
  beds numeric(5,2),
  baths numeric(5,2),
  sqft integer,
  lot_size numeric(12,2),
  year_built integer,
  occupancy_status text,
  condition text,
  seller_name text,
  phone text,
  email text,
  notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  confidence_score numeric(5,2) not null default 0,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_entities (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null,
  entity_type text not null default 'unknown',
  phone text,
  email text,
  source_profiles jsonb not null default '[]'::jsonb,
  markets jsonb not null default '[]'::jsonb,
  average_asking_price numeric(12,2),
  post_count integer not null default 0,
  deal_count integer not null default 0,
  buyer_signal_count integer not null default 0,
  reputation_score numeric(6,2) not null default 0,
  classification text,
  classification_confidence numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.harvester_duplicates (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.harvester_intakes(id) on delete cascade,
  matched_intake_id uuid references public.harvester_intakes(id) on delete set null,
  matched_seller_lead_id uuid references public.seller_leads(id) on delete set null,
  matched_deal_id text references public.deal_leads(id) on delete set null,
  duplicate_score numeric(5,2) not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  resolution_status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.harvester_buyer_matches (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid references public.harvester_intakes(id) on delete cascade,
  opportunity_id uuid references public.harvester_extracted_opportunities(id) on delete cascade,
  buyer_id text,
  buyer_name text not null,
  buyer_group text,
  match_score numeric(5,2) not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  recommended_action text,
  created_at timestamptz not null default now()
);

create table if not exists public.harvester_watchlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  criteria jsonb not null default '{}'::jsonb,
  notify_on_match boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.harvester_watchlist_matches (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.harvester_watchlists(id) on delete cascade,
  intake_id uuid references public.harvester_intakes(id) on delete cascade,
  opportunity_id uuid references public.harvester_extracted_opportunities(id) on delete cascade,
  match_score numeric(5,2) not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists harvester_intakes_source_type_idx on public.harvester_intakes(source_type);
create index if not exists harvester_intakes_classification_idx on public.harvester_intakes(classification);
create index if not exists harvester_opportunities_address_idx on public.harvester_extracted_opportunities(address);
create index if not exists harvester_opportunities_city_idx on public.harvester_extracted_opportunities(city);
create index if not exists harvester_opportunities_state_idx on public.harvester_extracted_opportunities(state);
create index if not exists harvester_opportunities_zip_idx on public.harvester_extracted_opportunities(zip);
create index if not exists harvester_opportunities_county_idx on public.harvester_extracted_opportunities(county);
create index if not exists harvester_opportunities_phone_idx on public.harvester_extracted_opportunities(phone);
create index if not exists harvester_opportunities_email_idx on public.harvester_extracted_opportunities(email);
create index if not exists marketplace_entities_phone_idx on public.marketplace_entities(phone);
create index if not exists marketplace_entities_email_idx on public.marketplace_entities(email);

alter table public.harvester_intakes enable row level security;
alter table public.harvester_extracted_opportunities enable row level security;
alter table public.marketplace_entities enable row level security;
alter table public.harvester_duplicates enable row level security;
alter table public.harvester_buyer_matches enable row level security;
alter table public.harvester_watchlists enable row level security;
alter table public.harvester_watchlist_matches enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'harvester_intakes' and policyname = 'harvester_intakes_authenticated_all'
  ) then
    create policy harvester_intakes_authenticated_all on public.harvester_intakes
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'harvester_extracted_opportunities' and policyname = 'harvester_extracted_opportunities_authenticated_all'
  ) then
    create policy harvester_extracted_opportunities_authenticated_all on public.harvester_extracted_opportunities
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'marketplace_entities' and policyname = 'marketplace_entities_authenticated_all'
  ) then
    create policy marketplace_entities_authenticated_all on public.marketplace_entities
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'harvester_duplicates' and policyname = 'harvester_duplicates_authenticated_all'
  ) then
    create policy harvester_duplicates_authenticated_all on public.harvester_duplicates
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'harvester_buyer_matches' and policyname = 'harvester_buyer_matches_authenticated_all'
  ) then
    create policy harvester_buyer_matches_authenticated_all on public.harvester_buyer_matches
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'harvester_watchlists' and policyname = 'harvester_watchlists_authenticated_all'
  ) then
    create policy harvester_watchlists_authenticated_all on public.harvester_watchlists
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'harvester_watchlist_matches' and policyname = 'harvester_watchlist_matches_authenticated_all'
  ) then
    create policy harvester_watchlist_matches_authenticated_all on public.harvester_watchlist_matches
      for all to authenticated using (true) with check (true);
  end if;
end $$;
