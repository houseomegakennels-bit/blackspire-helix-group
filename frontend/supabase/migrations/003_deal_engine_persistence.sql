create extension if not exists "pgcrypto";

create table if not exists public.deal_leads (
  id text primary key,
  seller_lead_id uuid references public.seller_leads(id) on delete set null,
  owner_name text,
  property_address text,
  mailing_address text,
  county text,
  city text,
  state text not null default 'NC',
  zip_code text,
  status text not null default 'Needs Analysis',
  motivation_score integer not null default 0 check (motivation_score between 0 and 100),
  motivation_reasons jsonb not null default '[]'::jsonb,
  property_type text,
  assessed_value numeric,
  estimated_equity numeric,
  source_data text,
  seller_dossier text,
  recommended_next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deal_analysis (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  estimated_arv numeric,
  purchase_price_target numeric,
  seller_asking_price numeric,
  repair_estimate numeric,
  closing_costs numeric,
  holding_costs numeric,
  buyer_profit_target numeric,
  assignment_fee_target numeric,
  rental_estimate numeric,
  flip_estimate numeric,
  wholesale_spread numeric,
  maximum_allowable_offer numeric,
  formula_settings jsonb not null default '{}'::jsonb,
  deal_rating text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.seller_conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  seller_asking_price numeric,
  seller_motivation text,
  timeline text,
  property_condition text,
  mortgage_status text,
  repairs_mentioned text,
  decision_makers text,
  next_action text,
  notes jsonb not null default '[]'::jsonb,
  ai_suggestions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.buyer_matches (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  county text,
  city text,
  state text not null default 'NC',
  zip_code text,
  property_type text,
  arv_range text,
  purchase_price_range text,
  repair_level text,
  exit_strategy text,
  rental_potential text,
  flip_potential text,
  top_buyer_matches jsonb not null default '[]'::jsonb,
  buyer_score integer not null default 0,
  investor_type_recommendation text,
  export_ready_deal_data text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  offer_made boolean not null default false,
  offer_accepted boolean not null default false,
  contract_sent boolean not null default false,
  contract_signed boolean not null default false,
  inspection_period text,
  earnest_money_deposit numeric,
  assignment_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.deal_packets (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  property_notes text,
  investor_summary text,
  buyer_email_blast text,
  buyer_sms_alert text,
  contact_instructions text,
  deadline_to_submit_offer text,
  comps_placeholder jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.deal_rooms (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  slug text not null unique,
  property_summary text,
  financial_breakdown jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  map_placeholder text,
  comps_placeholder jsonb not null default '[]'::jsonb,
  downloadable_pdf_label text,
  submit_interest_label text,
  request_walkthrough_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.disposition_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.deal_leads(id) on delete cascade,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.lead_notes
  alter column seller_lead_id drop not null;

create index if not exists deal_leads_status_idx on public.deal_leads(status);
create index if not exists deal_leads_score_idx on public.deal_leads(motivation_score desc);
create index if not exists deal_leads_property_idx on public.deal_leads(property_address);
create index if not exists disposition_logs_lead_created_idx on public.disposition_logs(lead_id, created_at desc);
create index if not exists disposition_logs_action_idx on public.disposition_logs(action_type);

alter table public.deal_leads enable row level security;
alter table public.deal_analysis enable row level security;
alter table public.seller_conversations enable row level security;
alter table public.buyer_matches enable row level security;
alter table public.contracts enable row level security;
alter table public.deal_packets enable row level security;
alter table public.deal_rooms enable row level security;
alter table public.disposition_logs enable row level security;
