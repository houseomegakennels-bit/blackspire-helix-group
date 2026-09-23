create table if not exists public.demo_access_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text,
  access_days integer not null default 7 check (access_days between 1 and 30),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists demo_access_invites_expires_idx
  on public.demo_access_invites (expires_at desc);

alter table public.demo_access_invites enable row level security;

-- Invitation records are server-only. The application service role creates and
-- redeems them, while browser clients receive only the opaque one-time token.
revoke all on table public.demo_access_invites from anon, authenticated;
