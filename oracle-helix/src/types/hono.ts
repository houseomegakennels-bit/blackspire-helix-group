import type { SupabaseClient } from '@supabase/supabase-js'

// Typed Hono context variables — shared across all route files
export type AppVariables = {
  userId: string
  userClient: SupabaseClient
}
