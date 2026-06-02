import { createMiddleware } from 'hono/factory'
import { createUserClient } from '../../lib/supabase.js'
import type { AppVariables } from '../../types/hono.js'

export const authMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const client = createUserClient(token)
    const { data: { user }, error } = await client.auth.getUser()

    if (error || !user) {
      return c.json({ success: false, error: 'Invalid token' }, 401)
    }

    c.set('userId', user.id)
    c.set('userClient', client)
  } catch {
    return c.json({ success: false, error: 'Auth error' }, 401)
  }

  await next()
})

// Optional auth — passes through even if no token (for public endpoints)
export const optionalAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const client = createUserClient(token)
      const { data: { user } } = await client.auth.getUser()
      if (user) {
        c.set('userId', user.id)
        c.set('userClient', client)
      }
    } catch { /* non-fatal */ }
  }

  await next()
})
