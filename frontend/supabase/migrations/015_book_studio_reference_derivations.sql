alter table if exists public.book_studio_references
  add column if not exists source_reference_id text,
  add column if not exists derivation_kind text not null default 'none',
  add column if not exists derivation_status text not null default 'approved',
  add column if not exists confidence double precision null,
  add column if not exists label text null,
  add column if not exists crop jsonb null;
