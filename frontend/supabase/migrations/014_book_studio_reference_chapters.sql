alter table if exists public.book_studio_references
  add column if not exists chapter_ids text[] not null default '{}'::text[];
