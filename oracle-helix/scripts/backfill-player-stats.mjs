// One-off backfill: populate player_game_stats with recent MLB game logs
// for every player that currently has props, so the Props Lab hit-rate
// chart has a real per-game series to draw. Mirrors the logic that the
// /api/cron/sync-player-stats route runs on a schedule.
//
//   node scripts/backfill-player-stats.mjs
//
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ---- load env from .env.local ------------------------------------
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const SEASON = String(new Date().getFullYear())
const MLB = 'https://statsapi.mlb.com/api/v1'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

async function main() {
  // 1. Players that have props, and whether they need pitching stats
  const { data: props } = await supabase.from('props').select('player_id, stat_type')
  const needPitch = new Map()
  for (const p of props ?? []) {
    needPitch.set(p.player_id, (needPitch.get(p.player_id) || false) || p.stat_type === 'pitcher_strikeouts')
  }
  const ids = [...needPitch.keys()]
  const { data: players } = await supabase.from('players').select('id, full_name, team_id').in('id', ids)
  console.log(`players with props: ${players?.length ?? 0}`)

  // 2. MLB id + team-abbr maps
  const sp = await fetch(`${MLB}/sports/1/players?season=${SEASON}`).then(r => r.json())
  const idByName = new Map()
  for (const p of sp.people ?? []) idByName.set(norm(p.fullName), p.id)
  const teams = await fetch(`${MLB}/teams?sportId=1`).then(r => r.json())
  const abbrByName = new Map()
  for (const t of teams.teams ?? []) abbrByName.set(t.name, t.abbreviation)

  // 3. Fetch game logs and build rows
  const rows = []
  let matched = 0, unmatched = []
  const work = async (pl) => {
    const mlbId = idByName.get(norm(pl.full_name))
    if (!mlbId) { unmatched.push(pl.full_name); return }
    matched++
    const group = needPitch.get(pl.id) ? 'pitching' : 'hitting'
    try {
      const gl = await fetch(`${MLB}/people/${mlbId}/stats?stats=gameLog&group=${group}&season=${SEASON}`).then(r => r.json())
      const splits = (gl.stats?.[0]?.splits ?? []).slice(-15)
      for (const s of splits) {
        const st = s.stat ?? {}
        const stats = group === 'pitching'
          ? { strikeouts: Number(st.strikeOuts ?? 0) }
          : { hits: Number(st.hits ?? 0), total_bases: Number(st.totalBases ?? 0), at_bats: Number(st.atBats ?? 0) }
        rows.push({
          player_id: pl.id, team_id: pl.team_id, game_date: s.date,
          opponent_abbr: abbrByName.get(s.opponent?.name) ?? null,
          source: 'mlb_statsapi', stats,
        })
      }
    } catch (e) { unmatched.push(pl.full_name + ':' + e.message) }
  }
  for (let i = 0; i < (players?.length ?? 0); i += 8) {
    await Promise.all((players.slice(i, i + 8)).map(work))
  }
  console.log(`matched ${matched}, unmatched ${unmatched.length}, rows ${rows.length}`)

  // Dedup by (player_id, game_date) — doubleheaders yield two splits on one
  // date; the unique index keys on date, so keep the latest game that day.
  const byKey = new Map()
  for (const r of rows) byKey.set(`${r.player_id}|${r.game_date}`, r)
  const deduped = [...byKey.values()]
  console.log(`deduped to ${deduped.length} rows`)

  // 4. Upsert in batches
  let inserted = 0
  for (let i = 0; i < deduped.length; i += 300) {
    const chunk = deduped.slice(i, i + 300)
    const { error } = await supabase.from('player_game_stats')
      .upsert(chunk, { onConflict: 'player_id,game_date', ignoreDuplicates: false })
    if (error) { console.error('upsert error:', error.message); process.exit(1) }
    inserted += chunk.length
  }
  console.log(`upserted ${inserted} game-log rows`)
}

main().catch(e => { console.error(e); process.exit(1) })
