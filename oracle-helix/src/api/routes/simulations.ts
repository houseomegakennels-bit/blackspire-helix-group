import { Hono } from 'hono'
import type { AppVariables } from '../../types/hono.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { runGameSimulation } from '../../engines/simulation/game-simulator.js'
import type { SimulationParams } from '../../types/index.js'

const router = new Hono<{ Variables: AppVariables }>()
router.use('*', authMiddleware)

// POST /api/simulations — run a new simulation
router.post('/', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json() as SimulationParams

  if (!body.sport || !body.simType) {
    return c.json({ success: false, error: 'sport and simType required' }, 400)
  }

  // Insert pending simulation record
  const { data: sim, error: insertErr } = await supabaseAdmin
    .from('simulations')
    .insert({
      user_id: userId,
      game_id: body.gameId,
      player_id: body.playerId,
      sim_type: body.simType,
      sport: body.sport,
      iterations: body.iterations ?? 10000,
      parameters: body.parameters,
      status: 'running',
    })
    .select()
    .single()

  if (insertErr) return c.json({ success: false, error: insertErr.message }, 500)

  try {
    const result = await runGameSimulation(body)

    // Update with results
    await supabaseAdmin
      .from('simulations')
      .update({
        status: 'complete',
        home_win_prob: result.homeWinProb,
        away_win_prob: result.awayWinProb,
        over_prob: result.overProb,
        confidence_interval: result.confidenceInterval,
        probability_curve: result.probabilityCurve,
        scenario_tree: result.scenarioTree,
        results: result.results,
        run_time_ms: result.runTimeMs,
        completed_at: result.completedAt,
      })
      .eq('id', sim.id)

    return c.json({ success: true, data: { ...sim, ...result, id: sim.id } })
  } catch (err) {
    await supabaseAdmin.from('simulations').update({ status: 'error' }).eq('id', sim.id)
    return c.json({ success: false, error: 'Simulation failed' }, 500)
  }
})

// GET /api/simulations — user's simulation history
router.get('/', async (c) => {
  const userId = c.get('userId') as string
  const sport = c.req.query('sport')

  let query = supabaseAdmin
    .from('simulations')
    .select('id, sim_type, sport, status, home_win_prob, away_win_prob, over_prob, run_time_ms, created_at, game_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (sport) query = query.eq('sport', sport)

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// GET /api/simulations/:id — get simulation results
router.get('/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  const { data, error } = await supabaseAdmin
    .from('simulations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error) return c.json({ success: false, error: 'Simulation not found' }, 404)
  return c.json({ success: true, data })
})

export default router
