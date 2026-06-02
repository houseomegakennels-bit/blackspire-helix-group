import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'

const router = new Hono()

// POST /api/auth/register
// Creates a pre-confirmed Supabase user via the admin API (bypasses email confirmation).
// The frontend calls this, then immediately calls supabase.auth.signInWithPassword() to get a session.
router.post('/register', async (c) => {
  let body: { email?: string; password?: string; name?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400)
  }

  const { email, password, name } = body

  if (!email || !password) {
    return c.json({ success: false, error: 'Email and password are required' }, 400)
  }

  if (password.length < 6) {
    return c.json({ success: false, error: 'Password must be at least 6 characters' }, 400)
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return c.json({ success: false, error: 'Invalid email address' }, 400)
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,            // Confirmed immediately — no email link required
    user_metadata: name ? { full_name: name } : {},
  })

  if (error) {
    // Surface recognisable error messages back to the client
    const msg = error.message ?? 'Registration failed'
    if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
      return c.json({ success: false, error: 'An account with that email already exists.' }, 409)
    }
    return c.json({ success: false, error: msg }, 400)
  }

  return c.json({ success: true, userId: data.user.id }, 201)
})

export default router
