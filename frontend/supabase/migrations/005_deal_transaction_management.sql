create extension if not exists "pgcrypto";

create table if not exists public.deal_contract_drafts (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  draft_type text not null,
  title text not null,
  body text not null default '',
  special_terms text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, draft_type)
);

create table if not exists public.deal_signature_packets (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  signature_status text not null default 'draft',
  sent_for_signature_at timestamptz,
  signed_by_seller_at timestamptz,
  signed_by_buyer_at timestamptz,
  signature_provider text,
  signature_packet_url text,
  signer_email text,
  signer_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id)
);

create table if not exists public.deal_title_checklist_items (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  item_key text not null,
  label text not null,
  status text not null default 'pending',
  notes text,
  due_date text,
  assigned_owner text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, item_key)
);

create table if not exists public.deal_emd_trackers (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  emd_amount numeric,
  emd_due_date text,
  emd_holder text,
  emd_holder_type text,
  emd_status text not null default 'pending',
  emd_payment_method text,
  emd_receipt_url text,
  emd_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id)
);

create table if not exists public.deal_assignment_fee_trackers (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  seller_contract_price numeric,
  buyer_assignment_price numeric,
  assignment_fee numeric,
  expected_net_fee numeric,
  title_company_fee numeric,
  other_closing_costs numeric,
  payout_status text not null default 'projected',
  payout_due_date text,
  payout_received_at text,
  payout_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id)
);

create table if not exists public.deal_closing_timeline_events (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  event_type text not null,
  label text not null,
  status text not null default 'upcoming',
  due_date text,
  completed_at text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deal_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  document_id text not null,
  file_name text not null,
  file_type text,
  category text not null,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  document_url text,
  storage_path text,
  notes text,
  linked_item_type text,
  linked_item_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id)
);

create index if not exists deal_contract_drafts_deal_idx on public.deal_contract_drafts(deal_id);
create index if not exists deal_signature_packets_deal_idx on public.deal_signature_packets(deal_id);
create index if not exists deal_title_checklist_items_deal_idx on public.deal_title_checklist_items(deal_id);
create index if not exists deal_emd_trackers_deal_idx on public.deal_emd_trackers(deal_id);
create index if not exists deal_assignment_fee_trackers_deal_idx on public.deal_assignment_fee_trackers(deal_id);
create index if not exists deal_closing_timeline_events_deal_idx on public.deal_closing_timeline_events(deal_id);
create index if not exists deal_documents_deal_idx on public.deal_documents(deal_id);

alter table public.deal_contract_drafts enable row level security;
alter table public.deal_signature_packets enable row level security;
alter table public.deal_title_checklist_items enable row level security;
alter table public.deal_emd_trackers enable row level security;
alter table public.deal_assignment_fee_trackers enable row level security;
alter table public.deal_closing_timeline_events enable row level security;
alter table public.deal_documents enable row level security;
