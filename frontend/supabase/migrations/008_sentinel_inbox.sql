-- Sentinel Inbox: the single operational attention queue for the command layer.
-- Sentinel owns ONLY inbox status. It does not duplicate deal/seller/harvester
-- data — each item points back to the originating record via (source_type, source_id).

create table if not exists public.sentinel_inbox_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,           -- alert | recommendation | watchlist | buyer_match | contract_issue | title_issue | harvester_review | follow_up
  source_type text not null,        -- which engine/table the item was projected from
  source_id text not null,          -- the originating record id (for idempotent sync)
  title text not null,
  body text,
  severity text not null default 'info',  -- info | warning | critical
  priority integer not null default 50,    -- 0..100, higher = more urgent
  deal_id text,
  seller_lead_id uuid,
  intake_id uuid,
  link_href text,
  recommended_action text,
  status text not null default 'unread',   -- unread | read | resolved | archived
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Idempotent sync: re-projecting the same source record updates rather than dupes.
create unique index if not exists sentinel_inbox_items_source_key
  on public.sentinel_inbox_items (source_type, source_id);

create index if not exists sentinel_inbox_items_status_idx
  on public.sentinel_inbox_items (status);

create index if not exists sentinel_inbox_items_priority_idx
  on public.sentinel_inbox_items (priority desc);

alter table public.sentinel_inbox_items enable row level security;

drop policy if exists "sentinel_inbox_items_authenticated_all" on public.sentinel_inbox_items;
create policy "sentinel_inbox_items_authenticated_all"
  on public.sentinel_inbox_items
  for all
  to authenticated
  using (true)
  with check (true);
