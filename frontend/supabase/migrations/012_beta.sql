-- Beta program tables: tester feedback + activity log (for the admin beta
-- dashboard and soft per-tester rate limits). Sentinel/admin read via service role.

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  user_email text,
  category text not null default 'other',
  message text not null,
  page_path text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists beta_feedback_created_idx on public.beta_feedback (created_at desc);

create table if not exists public.beta_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists beta_activity_user_action_idx on public.beta_activity (user_id, action, created_at desc);

alter table public.beta_feedback enable row level security;
alter table public.beta_activity enable row level security;
drop policy if exists "beta_feedback_authenticated_all" on public.beta_feedback;
create policy "beta_feedback_authenticated_all" on public.beta_feedback for all to authenticated using (true) with check (true);
drop policy if exists "beta_activity_authenticated_all" on public.beta_activity;
create policy "beta_activity_authenticated_all" on public.beta_activity for all to authenticated using (true) with check (true);
