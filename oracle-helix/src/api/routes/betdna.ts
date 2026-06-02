import { Hono } from 'hono'
import type { AppVariables } from '../../types/hono.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import type { BetEntry, SportKey } from '../../types/index.js'

const router = new Hono<{ Variables: AppVariables }>()
router.use('*', authMiddleware)

// GET /api/betdna — overview (same as analytics)
router.get('/', async (c) => {
  const userId = c.get('userId') as string

  const [profilesRes, betsRes] = await Promise.all([
    supabaseAdmin.from('betdna_profiles').select('*').eq('user_id', userId),
    supabaseAdmin.from('bet_tracker').select('sport, market, result, profit_loss, odds, stake, bet_placed_at').eq('user_id', userId).order('bet_placed_at', { ascending: false }).limit(50),
  ])

  const settled = (betsRes.data ?? []).filter(b => b.result !== null && b.result !== 'push' && b.result !== 'void')
  let streak = 0, streakType: 'win' | 'loss' | null = null
  for (const bet of settled) {
    if (!streakType) { streakType = bet.result as 'win' | 'loss'; streak = 1 }
    else if (bet.result === streakType) streak++
    else break
  }

  return c.json({
    success: true,
    data: {
      profiles: profilesRes.data ?? [],
      streak: { type: streakType, count: streak },
      recentBets: betsRes.data?.slice(0, 10) ?? [],
      disclaimer: 'ORACLE HELIX tracks analytics only. Not financial or gambling advice. Gamble responsibly.',
    },
  })
})

// GET /api/betdna/profile — user's BetDNA profile
router.get('/profile', async (c) => {
  const userId = c.get('userId') as string
  const sport = c.req.query('sport') as SportKey | undefined

  let query = supabaseAdmin
    .from('betdna_profiles')
    .select('*')
    .eq('user_id', userId)

  if (sport) query = query.eq('sport', sport)
  else query = query.is('sport', null)  // overall profile

  const { data, error } = await query.single()

  if (error) {
    // Auto-create if missing
    const { data: created } = await supabaseAdmin
      .from('betdna_profiles')
      .insert({ user_id: userId, sport: sport ?? null })
      .select()
      .single()
    return c.json({ success: true, data: created })
  }

  return c.json({ success: true, data })
})

// GET /api/betdna/bets — user's bet tracker entries
router.get('/bets', async (c) => {
  const userId = c.get('userId') as string
  const sport = c.req.query('sport')
  const result = c.req.query('result')
  const limit = parseInt(c.req.query('limit') ?? '50')

  let query = supabaseAdmin
    .from('bet_tracker')
    .select('*, game:games(scheduled_at, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation)), player:players(full_name), sportsbook:sportsbooks(key, name)')
    .eq('user_id', userId)
    .order('bet_placed_at', { ascending: false })
    .limit(limit)

  if (sport) query = query.eq('sport', sport)
  if (result) {
    if (result === 'pending') query = query.is('result', null)
    else query = query.eq('result', result)
  }

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// POST /api/betdna/bets — add a bet to tracker
router.post('/bets', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json() as Omit<BetEntry, 'id' | 'userId'>

  const { data, error } = await supabaseAdmin
    .from('bet_tracker')
    .insert({ ...body, user_id: userId })
    .select()
    .single()

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data }, 201)
})

// PATCH /api/betdna/bets/:id — settle a bet
router.patch('/bets/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const body = await c.req.json() as { result: string; closingOdds?: number; notes?: string }

  if (!['win', 'loss', 'push', 'void'].includes(body.result)) {
    return c.json({ success: false, error: 'Invalid result value' }, 400)
  }

  // Calculate profit/loss
  const { data: bet } = await supabaseAdmin.from('bet_tracker').select('odds, stake').eq('id', id).eq('user_id', userId).single()
  let profitLoss: number | undefined
  if (bet) {
    if (body.result === 'win') {
      const decimal = bet.odds > 0 ? 1 + bet.odds / 100 : 1 + 100 / Math.abs(bet.odds)
      profitLoss = bet.stake * (decimal - 1)
    } else if (body.result === 'loss') {
      profitLoss = -bet.stake
    } else {
      profitLoss = 0
    }
  }

  const { data, error } = await supabaseAdmin
    .from('bet_tracker')
    .update({
      result: body.result,
      closing_odds: body.closingOdds,
      notes: body.notes,
      profit_loss: profitLoss,
      settled_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// GET /api/betdna/analytics — summary analytics
router.get('/analytics', async (c) => {
  const userId = c.get('userId') as string

  const { data: profiles } = await supabaseAdmin
    .from('betdna_profiles')
    .select('*')
    .eq('user_id', userId)

  const { data: recentBets } = await supabaseAdmin
    .from('bet_tracker')
    .select('sport, market, result, profit_loss, odds, stake, bet_placed_at, confidence_level')
    .eq('user_id', userId)
    .not('result', 'is', null)
    .order('bet_placed_at', { ascending: false })
    .limit(100)

  // Calculate streak
  const settled = (recentBets ?? []).filter(b => b.result !== 'push' && b.result !== 'void')
  let currentStreak = 0
  let streakType: 'win' | 'loss' | null = null
  for (const bet of settled) {
    if (streakType === null) { streakType = bet.result as 'win' | 'loss'; currentStreak = 1 }
    else if (bet.result === streakType) currentStreak++
    else break
  }

  return c.json({
    success: true,
    data: {
      profiles: profiles ?? [],
      streak: { type: streakType, count: currentStreak },
      recentPerformance: recentBets?.slice(0, 10) ?? [],
      disclaimer: 'ORACLE HELIX tracks analytics only. This is not financial or gambling advice. Gamble responsibly.',
    },
  })
})

export default router
