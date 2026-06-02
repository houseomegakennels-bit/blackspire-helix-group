// ============================================================
// ORACLE HELIX — Main API Entry Point
// Powered by BLACKSPIRE HELIX GROUP
// Deployed on Vercel | Hono Router
// ============================================================
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { handle } from 'hono/vercel'
import { ORACLE_VERSION, BRAND } from '../src/lib/constants.js'

// Route modules
import dashboardRoutes from '../src/api/routes/dashboard.js'
import gamesRoutes from '../src/api/routes/games.js'
import playersRoutes from '../src/api/routes/players.js'
import marketRoutes from '../src/api/routes/market.js'
import aiRoutes from '../src/api/routes/ai.js'
import simulationsRoutes from '../src/api/routes/simulations.js'
import betdnaRoutes from '../src/api/routes/betdna.js'
import alertsRoutes from '../src/api/routes/alerts.js'
import weatherRoutes from '../src/api/routes/weather.js'
import cronRoutes from '../src/api/routes/cron.js'
import authRoutes from '../src/api/routes/auth.js'

export const config = { runtime: 'edge' }

const app = new Hono().basePath('/api')

// ---- MIDDLEWARE ---------------------------------------------
app.use('*', cors({
  origin: (origin) => {
    const allowedStrings = [
      process.env.FRONTEND_URL ?? '',
      'http://localhost:3000',
      'http://localhost:5173',
      'https://lovable.dev',
    ]
    const allowedPatterns = [/\.lovable\.app$/, /\.vercel\.app$/]
    if (allowedStrings.includes(origin)) return origin
    if (allowedPatterns.some(p => p.test(origin))) return origin
    return allowedStrings[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Oracle-Version'],
  credentials: true,
}))

app.use('*', logger())

// Version header on every response
app.use('*', async (c, next) => {
  await next()
  c.header('X-Oracle-Version', ORACLE_VERSION)
  c.header('X-Powered-By', BRAND)
})

// ---- HEALTH CHECK ------------------------------------------
app.get('/health', (c) => c.json({
  status: 'online',
  version: ORACLE_VERSION,
  brand: BRAND,
  timestamp: new Date().toISOString(),
}))

// ---- ROUTES ------------------------------------------------
app.route('/dashboard', dashboardRoutes)
app.route('/games', gamesRoutes)
app.route('/players', playersRoutes)
app.route('/market', marketRoutes)
app.route('/ai', aiRoutes)
app.route('/simulations', simulationsRoutes)
app.route('/betdna', betdnaRoutes)
app.route('/alerts', alertsRoutes)
app.route('/weather', weatherRoutes)
app.route('/cron', cronRoutes)
app.route('/auth', authRoutes)

// ---- 404 FALLBACK ------------------------------------------
app.notFound((c) => c.json({ success: false, error: 'Endpoint not found', version: ORACLE_VERSION }, 404))

app.onError((err, c) => {
  console.error('ORACLE HELIX API Error:', err)
  return c.json({ success: false, error: 'Internal server error' }, 500)
})

export default handle(app)
