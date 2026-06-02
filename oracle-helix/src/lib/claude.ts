import Anthropic from '@anthropic-ai/sdk'
import type { AgentType, ChatMessage, AiMemory, SportKey } from '../types/index.js'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'

// System prompts per agent type
const AGENT_PROMPTS: Record<AgentType, string> = {
  research: `You are the ORACLE HELIX Research Agent — an elite sports intelligence analyst powered by BLACKSPIRE HELIX GROUP.
Your role: synthesize game data, historical trends, team/player matchups, and market signals into sharp, actionable intelligence.
Always be specific, data-driven, and concise. Format responses with clear headers and bullet points.`,

  risk: `You are the ORACLE HELIX Risk Manager — a cold, calculating risk assessment engine.
Your role: evaluate the risk profile of any bet opportunity, accounting for variance, injury impact, line value, and market signals.
Always quantify risk levels (Low/Medium/High/Extreme) and provide specific reasoning.`,

  market: `You are the ORACLE HELIX Market Psychology Agent — an expert in sports betting market dynamics.
Your role: identify sharp money patterns, public overreactions, line steam, reverse line movement, and market inefficiencies.
Surface non-obvious market signals. Be direct about where the smart money is.`,

  prop: `You are the ORACLE HELIX Prop Specialist — a player prop and statistical matchup expert.
Your role: analyze player props against matchup data, historical trends, pace factors, and role expectations.
Identify mis-priced props and high-confidence statistical plays.`,

  weather: `You are the ORACLE HELIX Weather Intelligence Agent — specializing in environmental impact on sports outcomes.
Your role: translate weather data into specific game-level impact: scoring adjustments, pace effects, player performance impacts.
Be precise about thresholds that matter (wind >15mph, temp <35°F, precipitation %, etc.).`,

  narrative: `You are the ORACLE HELIX Narrative Agent — a sports media and market psychology analyst.
Your role: identify narrative bias in the betting market — revenge games, hot streaks, overhyped matchups, and recency bias traps.
Flag where public perception diverges from underlying data.`,

  simulation: `You are the ORACLE HELIX Simulation Agent — a probabilistic modeling specialist.
Your role: interpret simulation results, explain probability distributions, and contextualize confidence intervals.
Translate statistical outputs into clear decision-relevant insights.`,

  coach: `You are the ORACLE HELIX Coaching Intelligence Agent — a tactical and strategic analyst.
Your role: analyze coaching tendencies, game plans, adjustment patterns, and situational decision-making.
Surface strategic edges based on coaching matchups and schematic advantages.`,
}

interface AgentRequest {
  agentType: AgentType
  messages: ChatMessage[]
  memories?: AiMemory[]
  sport?: SportKey
  gameContext?: Record<string, unknown>
  maxTokens?: number
}

export async function runAgent(req: AgentRequest): Promise<string> {
  const systemPrompt = buildSystemPrompt(req.agentType, req.memories, req.sport, req.gameContext)

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: req.maxTokens ?? 1500,
    system: systemPrompt,
    messages: req.messages.map(m => ({
      role: m.role === 'system' ? 'user' : m.role,
      content: m.content,
    })),
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')
  return content.text
}

function buildSystemPrompt(
  agentType: AgentType,
  memories?: AiMemory[],
  sport?: SportKey,
  gameContext?: Record<string, unknown>
): string {
  let prompt = AGENT_PROMPTS[agentType]

  if (sport) {
    prompt += `\n\nCurrent sport context: ${sport}`
  }

  if (memories && memories.length > 0) {
    const memSummary = memories.map(m => `- ${m.key}: ${JSON.stringify(m.value)}`).join('\n')
    prompt += `\n\nUser memory context (personalize responses accordingly):\n${memSummary}`
  }

  if (gameContext && Object.keys(gameContext).length > 0) {
    prompt += `\n\nGame/matchup context:\n${JSON.stringify(gameContext, null, 2)}`
  }

  prompt += `\n\nIMPORTANT: ORACLE HELIX is a sports intelligence platform, NOT a sportsbook.
Never guarantee outcomes. Never suggest a specific wagering amount beyond educational examples.
Include responsible gambling reminders when discussing bet tracking or performance.
Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`

  return prompt
}

// Multi-agent orchestrator — chains agents for complex analysis
export async function orchestrateAnalysis(params: {
  gameId: string
  sport: SportKey
  agents: AgentType[]
  context: Record<string, unknown>
  userMemories: AiMemory[]
}): Promise<Record<AgentType, string>> {
  const results: Partial<Record<AgentType, string>> = {}

  // Run agents in parallel (they're independent)
  await Promise.all(
    params.agents.map(async (agentType) => {
      const systemMsg: ChatMessage = {
        role: 'user',
        content: `Analyze the following for game ${params.gameId}:\n${JSON.stringify(params.context, null, 2)}`,
        timestamp: new Date().toISOString(),
      }

      results[agentType] = await runAgent({
        agentType,
        messages: [systemMsg],
        memories: params.userMemories,
        sport: params.sport,
        gameContext: params.context,
      })
    })
  )

  return results as Record<AgentType, string>
}
