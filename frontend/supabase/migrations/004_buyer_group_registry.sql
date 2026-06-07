create extension if not exists "pgcrypto";

create table if not exists public.buyer_group_registry (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  group_type text not null default 'hedge_fund_group',
  aliases jsonb not null default '[]'::jsonb,
  states jsonb not null default '[]'::jsonb,
  counties jsonb not null default '[]'::jsonb,
  website text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buyer_group_registry_active_idx
  on public.buyer_group_registry(active);

alter table public.buyer_group_registry enable row level security;
