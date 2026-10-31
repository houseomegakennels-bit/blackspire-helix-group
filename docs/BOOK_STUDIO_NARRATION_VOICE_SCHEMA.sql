-- LOCAL REVIEW PROPOSAL ONLY. Not applied and not a generated migration.
-- Generate a migration with the supported CLI before an authorized release.
-- Nullable/no default preserves existing books. No grants or RLS changes.
ALTER TABLE public.book_studio_scenes
  ADD COLUMN narration_voice text NULL
  CONSTRAINT book_studio_scenes_narration_voice_check
  CHECK (narration_voice IS NULL OR narration_voice IN (
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx',
    'sage', 'shimmer', 'verse', 'marin', 'cedar'
  ));
