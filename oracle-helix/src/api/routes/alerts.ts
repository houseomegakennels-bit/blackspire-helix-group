import { Hono } from 'hono'
import type { AppVariables } from '../../types/hono.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'

const router = new Hono<{ Variables: AppVariables }>()
router.use('*', authMiddleware)

// GET /api/alerts — user's alert configs
router.get('/', async (c) => {
  const userId = c.get('userId') as string

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// POST /api/alerts — create an alert
router.post('/', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .insert({ ...body, user_id: userId })
    .select()
    .single()

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data }, 201)
})

// DELETE /api/alerts/:id — deactivate alert
router.delete('/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  await supabaseAdmin.from('alerts').update({ is_active: false }).eq('id', id).eq('user_id', userId)
  return c.json({ success: true })
})

// GET /api/alerts/feed — recent alert events (sharp feed)
router.get('/feed', async (c) => {
  const userId = c.get('userId') as string
  const unreadOnly = c.req.query('unread') === 'true'

  let query = supabaseAdmin
    .from('v_alert_feed')
    .select('*')
    .eq('user_id', userId)
    .order('triggered_at', { ascending: false })
    .limit(50)

  if (unreadOnly) query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// PATCH /api/alerts/feed/read-all — mark all events read
router.patch('/feed/read-all', async (c) => {
  const userId = c.get('userId') as string

  await supabaseAdmin
    .from('alert_events')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  return c.json({ success: true })
})

// GET /api/alerts/feed/unread-count — badge count
router.get('/feed/unread-count', async (c) => {
  const userId = c.get('userId') as string

  const { count } = await supabaseAdmin
    .from('alert_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  return c.json({ success: true, data: { count: count ?? 0 } })
})

export default router
