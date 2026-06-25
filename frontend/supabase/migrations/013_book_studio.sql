create table if not exists public.book_studio_books (
  id text primary key,
  slug text not null unique,
  title text not null,
  synopsis text not null default '',
  status text not null default 'Draft',
  manuscript_text text not null default '',
  manuscript_asset_id text,
  cover_asset_id text,
  visual_direction text not null default 'cinematic realism',
  palette text not null default 'black, gold, amber, natural skin tones',
  medium text not null default 'high-detail illustrated still',
  tone text not null default 'dramatic, polished, immersive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.book_studio_assets (
  id text primary key,
  book_id text not null references public.book_studio_books(id) on delete cascade,
  kind text not null,
  label text not null,
  mime_type text not null,
  relative_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists book_studio_assets_book_idx on public.book_studio_assets (book_id, created_at desc);

create table if not exists public.book_studio_references (
  id text primary key,
  book_id text not null references public.book_studio_books(id) on delete cascade,
  asset_id text not null references public.book_studio_assets(id) on delete cascade,
  source text not null,
  role text not null,
  approved boolean not null default false,
  character_ids text[] not null default '{}'::text[],
  scene_ids text[] not null default '{}'::text[],
  notes text not null default ''
);
create index if not exists book_studio_references_book_idx on public.book_studio_references (book_id);

create table if not exists public.book_studio_characters (
  id text primary key,
  book_id text not null references public.book_studio_books(id) on delete cascade,
  name text not null,
  aliases jsonb not null default '[]'::jsonb,
  core_description text not null default '',
  age_range text not null default 'adult',
  sex text not null default 'unknown',
  facial_traits text not null default '',
  body_traits text not null default '',
  hair text not null default '',
  vibe text not null default '',
  continuity_notes text not null default '',
  required_for_render boolean not null default true,
  status text not null default 'draft',
  canonical_reference_id text,
  backup_reference_ids text[] not null default '{}'::text[],
  voice_assignment jsonb
);
create index if not exists book_studio_characters_book_idx on public.book_studio_characters (book_id);

create table if not exists public.book_studio_chapters (
  id text primary key,
  book_id text not null references public.book_studio_books(id) on delete cascade,
  chapter_order integer not null,
  title text not null,
  summary text not null default '',
  audio_asset_id text,
  video_asset_id text
);
create index if not exists book_studio_chapters_book_idx on public.book_studio_chapters (book_id, chapter_order);

create table if not exists public.book_studio_scenes (
  id text primary key,
  book_id text not null references public.book_studio_books(id) on delete cascade,
  chapter_id text not null references public.book_studio_chapters(id) on delete cascade,
  scene_order integer not null,
  title text not null,
  source_text text not null default '',
  summary text not null default '',
  mood text not null default '',
  location text not null default '',
  time_of_day text not null default '',
  character_ids text[] not null default '{}'::text[],
  modifiers jsonb not null default '[]'::jsonb,
  image_prompt text not null default '',
  image_status text not null default 'missing',
  audio_status text not null default 'missing',
  review_status text not null default 'pending',
  priority text not null default 'supporting',
  image_asset_id text,
  audio_asset_id text,
  estimated_duration_seconds integer not null default 4,
  render_manifest jsonb
);
create index if not exists book_studio_scenes_book_idx on public.book_studio_scenes (book_id, scene_order);
create index if not exists book_studio_scenes_chapter_idx on public.book_studio_scenes (chapter_id, scene_order);

alter table public.book_studio_books enable row level security;
alter table public.book_studio_assets enable row level security;
alter table public.book_studio_references enable row level security;
alter table public.book_studio_characters enable row level security;
alter table public.book_studio_chapters enable row level security;
alter table public.book_studio_scenes enable row level security;

drop policy if exists "book_studio_books_authenticated_all" on public.book_studio_books;
create policy "book_studio_books_authenticated_all" on public.book_studio_books
  for all to authenticated using (true) with check (true);

drop policy if exists "book_studio_assets_authenticated_all" on public.book_studio_assets;
create policy "book_studio_assets_authenticated_all" on public.book_studio_assets
  for all to authenticated using (true) with check (true);

drop policy if exists "book_studio_references_authenticated_all" on public.book_studio_references;
create policy "book_studio_references_authenticated_all" on public.book_studio_references
  for all to authenticated using (true) with check (true);

drop policy if exists "book_studio_characters_authenticated_all" on public.book_studio_characters;
create policy "book_studio_characters_authenticated_all" on public.book_studio_characters
  for all to authenticated using (true) with check (true);

drop policy if exists "book_studio_chapters_authenticated_all" on public.book_studio_chapters;
create policy "book_studio_chapters_authenticated_all" on public.book_studio_chapters
  for all to authenticated using (true) with check (true);

drop policy if exists "book_studio_scenes_authenticated_all" on public.book_studio_scenes;
create policy "book_studio_scenes_authenticated_all" on public.book_studio_scenes
  for all to authenticated using (true) with check (true);
