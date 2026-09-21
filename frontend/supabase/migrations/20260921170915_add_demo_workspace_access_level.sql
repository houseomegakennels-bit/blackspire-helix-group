alter table public.demo_access_invites
  add column if not exists access_level text not null default 'read_only'
  check (access_level in ('read_only', 'real_estate_operator'));

comment on column public.demo_access_invites.access_level is
  'Controls whether a one-time invite grants the read-only demo or the time-limited real-estate operator workspace.';
