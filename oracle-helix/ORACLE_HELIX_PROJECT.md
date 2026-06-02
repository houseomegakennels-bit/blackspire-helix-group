# ORACLE HELIX - Project Reference
**Powered by BLACKSPIRE HELIX GROUP**
Last updated: 2026-05-27

---

## What It Is
ORACLE HELIX is a next-generation AI-powered sports intelligence operating system.
It is NOT a sportsbook. No betting, no wagering. Pure analytics, AI insights, simulations, and market intelligence.

## Stack
| Layer | Technology |
|---|---|
| Frontend | Lovable (React) - separate project |
| Backend API | Node.js + TypeScript + Hono - this repo |
| Database | Supabase/PostgreSQL - NEW dedicated project |
| Cache | Upstash Redis (free tier) |
| AI | Claude API (Sonnet 4.6) + multi-agent system |
| Hosting | Vercel |
| Real-time | Supabase Realtime (WebSocket) |

## Local Path
`C:\Users\USER\Desktop\blackspire-helix-group\oracle-helix\`

---

## Supabase Setup (NEW project â€” not the Buyer Engine)
1. Go to supabase.com â†’ New Project
2. Name: `oracle-helix`
3. Copy URL + anon key + service role key into `.env.local`
4. Run all 5 migrations in order:
   - `001_users_subscriptions.sql`
   - `002_sports_games_teams_players.sql`
   - `003_odds_market_engine.sql`
   - `004_ai_intelligence_betdna.sql`
   - `005_realtime_functions.sql`

---

## Vercel Deploy
1. Push repo to GitHub
2. Import in Vercel
3. Set all env vars (see `.env.example`)
4. Root directory: `oracle-helix/`
5. Build: none needed (serverless functions)
6. The single entry: `api/index.ts` routes all `/api/*`

---

## Free Sports API Setup

| API | Cost | Key needed | What it provides |
|---|---|---|---|
| The Odds API | 500 req/mo free | YES â€” theoddsapi.com | Live odds, all sports |
| ESPN Unofficial | Free | No | Scores, schedules, rosters, news |
| MLB Stats API | Free | No | MLB schedules, stats, box scores |
| NHL Stats API | Free | No | NHL schedules, stats, rosters |
| Ball Don't Lie | Free tier | YES â€” balldontlie.io | NBA stats, injuries |
| Open-Meteo | Free | No | Weather for any coordinates |

---

## API Endpoints (all at `/api/...`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | System status |
| `/api/dashboard` | GET | Intelligence Dashboard aggregated feed |
| `/api/dashboard/layout` | GET/POST | War Room layouts |
| `/api/games` | GET | Today's games + odds snapshot |
| `/api/games/:id` | GET | Full game detail |
| `/api/games/:id/odds` | GET | All sportsbook odds |
| `/api/games/:id/line-movement` | GET | Line history chart data |
| `/api/games/:id/props` | GET | Player props |
| `/api/games/:id/matchup` | GET | AI matchup report |
| `/api/players` | GET | Search players |
| `/api/players/:id` | GET | Player detail + stats + props |
| `/api/players/:id/props` | GET | All player props |
| `/api/players/:id/spray-chart` | GET | MLB spray chart |
| `/api/players/:id/pitch-data` | GET | MLB pitch analytics |
| `/api/market/ev` | GET | Positive EV opportunities |
| `/api/market/sharp-feed` | GET | Sharp money signals |
| `/api/market/psychology/:gameId` | GET | Market psychology score |
| `/api/market/public-betting/:gameId` | GET | Public betting % |
| `/api/market/arbitrage` | GET | Active arb opportunities |
| `/api/market/narrative/:gameId` | GET | Narrative intelligence |
| `/api/ai/chat` | POST | Chat with AI agent |
| `/api/ai/orchestrate` | POST | Multi-agent analysis |
| `/api/ai/sessions` | GET | Chat history |
| `/api/ai/research-cards` | GET | AI research cards |
| `/api/ai/memories` | GET/PUT | User AI memories |
| `/api/simulations` | POST/GET | Run + list simulations |
| `/api/simulations/:id` | GET | Simulation results |
| `/api/betdna/profile` | GET | BetDNA analytics profile |
| `/api/betdna/bets` | GET/POST | Bet tracker |
| `/api/betdna/bets/:id` | PATCH | Settle a bet |
| `/api/betdna/analytics` | GET | Summary analytics |
| `/api/alerts` | GET/POST/DELETE | Alert management |
| `/api/alerts/feed` | GET | Alert events (sharp feed) |
| `/api/alerts/feed/unread-count` | GET | Badge count |
| `/api/weather/:gameId` | GET | Game weather |
| `/api/weather` | GET | All impactful weather today |

---

## Lovable Frontend Connection
Lovable connects via:
1. **Supabase direct**: Use the Supabase URL + anon key for all database reads (games, players, teams, odds, etc.)
2. **This backend API**: For AI chat, simulations, complex calculations, weather fetching
3. **Supabase Realtime**: Subscribe to `games`, `odds`, `line_movement`, `sharp_signals`, `alert_events` for live updates

### Env vars to give Lovable:
- `VITE_SUPABASE_URL` = your new Supabase URL
- `VITE_SUPABASE_ANON_KEY` = your anon key
- `VITE_API_BASE_URL` = your Vercel deploy URL (e.g. `https://oracle-helix.vercel.app`)

---

## Database Tables (37 total)
### Users
- `profiles` â†’ `subscriptions` â†’ `user_preferences` â†’ `saved_layouts` â†’ `user_roles`

### Sports Data
- `sports` â†’ `teams` â†’ `stadiums` â†’ `players` â†’ `player_injuries` â†’ `games` â†’ `game_stats` â†’ `player_game_stats`

### MLB Advanced
- `mlb_pitch_data` â†’ `mlb_park_factors` â†’ `mlb_spray_charts`

### Odds & Market
- `sportsbooks` â†’ `odds` â†’ `line_movement` â†’ `props` â†’ `public_betting` â†’ `sharp_signals` â†’ `market_psychology` â†’ `ev_calculations` â†’ `weather_data` â†’ `arbitrage_opportunities`

### AI Intelligence
- `ai_memories` â†’ `ai_sessions` â†’ `ai_research_cards` â†’ `narrative_intelligence` â†’ `social_sentiment` â†’ `matchup_reports`

### BetDNA & Tracking
- `betdna_profiles` â†’ `bet_tracker` â†’ `simulations` â†’ `alerts` â†’ `alert_events`

### Views
- `v_todays_games` â€” games + odds snapshot + weather impact
- `v_alert_feed` â€” alerts with game context
- `v_positive_ev` â€” positive EV with book + game details

---

## AI Agents (8 total)
| Agent | Role |
|---|---|
| Research | Game data synthesis, historical trends |
| Risk Manager | Risk scoring, variance analysis |
| Market Psychology | Sharp/public patterns, steam moves |
| Prop Specialist | Player prop analysis, stat matchups |
| Weather | Environmental impact analysis |
| Narrative | Media bias, hype detection |
| Simulation | Probability interpretation |
| Coach | Tactical/schematic edge analysis |

---

## Supported Sports
| Sport | Phase | APIs |
|---|---|---|
| NBA | Phase 1 | Ball Don't Lie + ESPN |
| NFL | Phase 1 | ESPN + The Odds API |
| MLB | Phase 1 | MLB Stats API (official) + ESPN |
| NHL | Phase 1 | NHL API (official) + ESPN |
| WNBA | Phase 1 | ESPN + The Odds API |
| PGA | Phase 2 | ESPN |
| UFC, Soccer, NCAA, Tennis, NASCAR, Esports | Future | TBD |

---

## Phase Roadmap
| Phase | Focus |
|---|---|
| Phase 1 (NOW) | DB schemas + all API routes + Lovable connection ready |
| Phase 2 | Live data sync jobs (n8n or cron), odds poller, injury feed |
| Phase 3 | AI agent enhancement, matchup report auto-generation |
| Phase 4 | Real-time War Room, WebSocket live game feed |
| Phase 5 | Autonomous research agents, personalization engine |

