create extension if not exists "pgcrypto";

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  template_type text not null,
  name text not null,
  intended_purpose text not null default '',
  source_name text not null default '',
  source_url text not null default '',
  license_status text not null default 'unknown',
  approval_status text not null default 'reference_only',
  state text,
  version text not null default 'reference',
  required_fields jsonb not null default '[]'::jsonb,
  optional_fields jsonb not null default '[]'::jsonb,
  variable_map jsonb not null default '{}'::jsonb,
  storage_path text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deal_contract_drafts
  add column if not exists template_id uuid references public.contract_templates(id) on delete set null,
  add column if not exists template_type text,
  add column if not exists status text not null default 'draft',
  add column if not exists generated_body text,
  add column if not exists generated_pdf_url text,
  add column if not exists editable_payload jsonb not null default '{}'::jsonb,
  add column if not exists legal_disclaimer_acknowledged boolean not null default false;

update public.deal_contract_drafts
set
  template_type = coalesce(template_type, draft_type),
  generated_body = coalesce(nullif(generated_body, ''), body),
  status = coalesce(nullif(status, ''), 'draft')
where true;

create table if not exists public.contract_generation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null references public.deal_leads(id) on delete cascade,
  template_id uuid references public.contract_templates(id) on delete set null,
  action text not null,
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists contract_templates_type_idx on public.contract_templates(template_type);
create index if not exists contract_templates_key_idx on public.contract_templates(template_key);
create index if not exists deal_contract_drafts_template_idx on public.deal_contract_drafts(template_type);
create index if not exists contract_generation_audit_logs_deal_idx on public.contract_generation_audit_logs(deal_id);

alter table public.contract_templates enable row level security;
alter table public.contract_generation_audit_logs enable row level security;
