import { Hono } from 'hono'
import type { AppVariables } from '../../types/hono.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { runAgent, orchestrateAnalysis } from '../../lib/claude.js'
import { authMiddleware, optionalAuth } from '../middleware/auth.js'
import type { AgentType, ChatMessage, SportKey } from '../../types/index.js'

const router = new Hono<{ Variables: AppVariables }>()

// GET /api/ai/research-cards — public + user-specific cards (no auth required)
router.get('/research-cards', optionalAuth, async (c) => {
  const userId = c.get('userId') as string | undefined
  const sport = c.req.query('sport')
  const cardType = c.req.query('type')

  let query = supabaseAdmin
    .from('ai_research_cards')
    .select('id, card_type, sport, title, headline, tags, generated_at, insights')
    .order('generated_at', { ascending: false })
    .limit(20)

  // Return public cards; if authenticated, also include user's private cards
  if (userId) {
    query = query.or(`user_id.is.null,user_id.eq.${userId}`)
  } else {
    query = query.is('user_id', null)
  }

  if (sport) query = query.eq('sport', sport)
  if (cardType) query = query.eq('card_type', cardType)

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// All remaining AI routes require authentication
router.use('*', authMiddleware)

// POST /api/ai/chat — send message to an AI agent
router.post('/chat', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const { sessionId, agentType = 'research', message, sport, gameId } = body as {
    sessionId?: string
    agentType: AgentType
    message: string
    sport?: SportKey
    gameId?: string
  }

  if (!message?.trim()) return c.json({ success: false, error: 'Message required' }, 400)

  // Load or create session
  let session
  if (sessionId) {
    const { data } = await supabaseAdmin.from('ai_sessions').select('*').eq('id', sessionId).eq('user_id', userId).single()
    session = data
  }

  if (!session) {
    const { data } = await supabaseAdmin.from('ai_sessions').insert({
      user_id: userId,
      agent_type: agentType,
      messages: [],
      context: { sport, gameId },
    }).select().single()
    session = data
  }

  // Load user memories for personalization
  const { data: memories } = await supabaseAdmin
    .from('ai_memories')
    .select('*')
    .eq('user_id', userId)
    .or(`sport.eq.${sport},sport.is.null`)
    .limit(20)

  const newMessage: ChatMessage = {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  }

  const history: ChatMessage[] = [...(session.messages ?? []), newMessage]

  // Build game context if gameId provided
  let gameContext: Record<string, unknown> = {}
  if (gameId) {
    const { data: game } = await supabaseAdmin
      .from('v_todays_games')
      .select('*')
      .eq('id', gameId)
      .single()
    if (game) gameContext = { game }
  }

  // Run agent
  const response = await runAgent({
    agentType,
    messages: history,
    memories: memories ?? [],
    sport,
    gameContext,
    maxTokens: 2000,
  })

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString(),
    agentType,
  }

  const updatedMessages = [...history, assistantMessage]

  // Persist session
  await supabaseAdmin
    .from('ai_sessions')
    .update({ messages: updatedMessages, updated_at: new Date().toISOString() })
    .eq('id', session.id)

  return c.json({
    success: true,
    data: {
      sessionId: session.id,
      message: assistantMessage,
      agentType,
    },
  })
})

// POST /api/ai/orchestrate — run multiple agents simultaneously
router.post('/orchestrate', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const { gameId, sport, agents } = body as {
    gameId: string
    sport: SportKey
    agents: AgentType[]
  }

  if (!gameId || !sport || !agents?.length) {
    return c.json({ success: false, error: 'gameId, sport, and agents required' }, 400)
  }

  // Build rich game context
  const [gameRes, oddsRes, weatherRes, injuryRes, psychRes] = await Promise.all([
    supabaseAdmin.from('v_todays_games').select('*').eq('id', gameId).single(),
    supabaseAdmin.from('odds').select('*, sportsbook:sportsbooks(key)').eq('game_id', gameId).limit(30),
    supabaseAdmin.from('weather_data').select('*').eq('game_id', gameId).order('fetched_at', { ascending: false }).limit(1).single(),
    supabaseAdmin.from('player_injuries').select('*, player:players(full_name, team:teams(abbreviation))').eq('is_active', true),
    supabaseAdmin.from('market_psychology').select('*').eq('game_id', gameId).order('calculated_at', { ascending: false }).limit(1).single(),
  ])

  const context = {
    game: gameRes.data,
    odds: oddsRes.data,
    weather: weatherRes.data,
    injuries: injuryRes.data,
    marketPsychology: psychRes.data,
  }

  const { data: memories } = await supabaseAdmin
    .from('ai_memories')
    .select('*')
    .eq('user_id', userId)
    .limit(20)

  const results = await orchestrateAnalysis({
    gameId,
    sport,
    agents,
    context,
    userMemories: memories ?? [],
  })

  // Save as research card
  const combinedContent = Object.entries(results)
    .map(([agent, content]) => `## ${agent.toUpperCase()} ANALYSIS\n\n${content}`)
    .join('\n\n---\n\n')

  await supabaseAdmin.from('ai_research_cards').insert({
    user_id: userId,
    game_id: gameId,
    card_type: 'matchup',
    sport,
    title: `Multi-Agent Analysis — ${gameRes.data?.home_abbr ?? ''} vs ${gameRes.data?.away_abbr ?? ''}`,
    headline: `${agents.length} AI agents analyzed this matchup`,
    content: combinedContent,
    insights: Object.entries(results).map(([agent, _]) => ({ key: agent, value: 'complete', confidence: 0.9 })),
    tags: ['orchestrated', sport, ...agents],
  })

  return c.json({
    success: true,
    data: { results, gameId, agentsRun: agents },
  })
})

// GET /api/ai/sessions — user's chat sessions
router.get('/sessions', async (c) => {
  const userId = c.get('userId') as string

  const { data, error } = await supabaseAdmin
    .from('ai_sessions')
    .select('id, agent_type, title, created_at, updated_at, is_active, context')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// DELETE /api/ai/sessions/:id — end a session
router.delete('/sessions/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  await supabaseAdmin.from('ai_sessions').update({ is_active: false }).eq('id', id).eq('user_id', userId)
  return c.json({ success: true })
})


// GET /api/ai/memories — user's AI memories
router.get('/memories', async (c) => {
  const userId = c.get('userId') as string

  const { data, error } = await supabaseAdmin
    .from('ai_memories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// PUT /api/ai/memories — upsert a memory
router.put('/memories', async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()

  const { data, error } = await supabaseAdmin
    .from('ai_memories')
    .upsert({ ...body, user_id: userId }, { onConflict: 'user_id,memory_type,key' })
    .select()

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

export default router
