create table if not exists public.demo_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.demo_workspaces enable row level security;
revoke all on public.demo_workspaces from anon, authenticated;
grant select,insert,update,delete on public.demo_workspaces to service_role;
comment on table public.demo_workspaces is 'Isolated demonstration records; server-owned user scope, no production workflow dispatch.';
