export const SPORTS = [
  { key: "NBA", label: "NBA", live: 6 },
  { key: "NFL", label: "NFL", live: 2 },
  { key: "MLB", label: "MLB", live: 4 },
  { key: "NHL", label: "NHL", live: 3 },
  { key: "WNBA", label: "WNBA", live: 1 },
  { key: "PGA", label: "PGA", live: 1 },
];

export const FUTURE_SPORTS = ["UFC", "Soccer", "NCAA", "Tennis", "NASCAR", "Esports"];

export const intelligenceScores = [
  { name: "LAL vs BOS", helix: 94, ev: "+7.2%", sharp: 88, narrative: "Revenge", sport: "NBA" },
  { name: "KC vs BUF", helix: 91, ev: "+5.4%", sharp: 76, narrative: "Weather", sport: "NFL" },
  { name: "NYY vs HOU", helix: 87, ev: "+4.1%", sharp: 71, narrative: "Pitcher Edge", sport: "MLB" },
  { name: "EDM vs TOR", helix: 82, ev: "+3.8%", sharp: 65, narrative: "Goalie Swap", sport: "NHL" },
  { name: "DAL vs PHX", helix: 79, ev: "+2.9%", sharp: 61, narrative: "Pace Mismatch", sport: "NBA" },
];

export const lineMovers = [
  { game: "Heat -3.5 → -5.5", move: 2.0, book: "DK", time: "12m" },
  { game: "Chiefs ML 145 → 122", move: -23, book: "FD", time: "32m" },
  { game: "Yankees u8.5 → u8", move: -0.5, book: "MGM", time: "1h" },
  { game: "Oilers +1.5 → -1.5", move: 3.0, book: "Caesars", time: "1h" },
];

export const sharpAlerts = [
  { tag: "STEAM", text: "Sharp steam on Celtics -4 across 5 books", sport: "NBA", time: "2m" },
  { tag: "RLM", text: "Reverse line movement on Bills u47.5 despite 71% public on over", sport: "NFL", time: "8m" },
  { tag: "WEATHER", text: "20mph crosswind expected at Arrowhead — totals dropping", sport: "NFL", time: "14m" },
  { tag: "INJURY", text: "Embiid questionable — line moved 3pts in 6 minutes", sport: "NBA", time: "21m" },
  { tag: "CHAOS", text: "Chaos detector spike: 3 lineup changes + weather + sharp money", sport: "MLB", time: "33m" },
];

// Deterministic pseudo-random so SSR and client render identical values
function pr(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export const heatmap = Array.from({ length: 12 }, (_, i) =>
  Array.from({ length: 8 }, (_, j) => ({
    x: j, y: i, v: Math.round(40 + Math.sin(i * 0.7 + j * 0.5) * 30 + pr(i * 8 + j) * 25),
  }))
).flat();

export const winProbabilityCurve = Array.from({ length: 48 }, (_, i) => ({
  t: i,
  home: 50 + Math.sin(i / 4) * 18 + pr(i + 1) * 6,
  away: 50 - Math.sin(i / 4) * 18 + pr(i + 100) * 6,
}));

export const trendData = Array.from({ length: 14 }, (_, i) => ({
  d: `D${i + 1}`,
  roi: Math.round((Math.sin(i / 2) * 8 + i * 0.6 + pr(i + 200) * 3) * 10) / 10,
  units: Math.round((Math.cos(i / 3) * 4 + i * 0.3) * 10) / 10,
}));

export const radarMatchup = [
  { metric: "Offense", home: 92, away: 78 },
  { metric: "Defense", home: 71, away: 88 },
  { metric: "Pace", home: 84, away: 62 },
  { metric: "3PT", home: 88, away: 74 },
  { metric: "Rebound", home: 66, away: 81 },
  { metric: "Health", home: 79, away: 90 },
];

export const propHitRate = Array.from({ length: 10 }, (_, i) => ({
  game: `G${i + 1}`,
  line: 24.5,
  actual: 18 + pr(i + 300) * 16,
}));

export const featuredGames = [
  {
    id: "lal-bos",
    home: { code: "BOS", name: "Celtics", score: null, logo: "🟢" },
    away: { code: "LAL", name: "Lakers", score: null, logo: "🟡" },
    sport: "NBA",
    tip: "Tonight · 8:00 PM ET",
    spread: "BOS -4.5",
    total: "228.5",
    helix: 94,
    narrative: "Revenge game · Sharp money on home",
  },
  {
    id: "kc-buf",
    home: { code: "BUF", name: "Bills", score: null, logo: "🦬" },
    away: { code: "KC", name: "Chiefs", score: null, logo: "🏈" },
    sport: "NFL",
    tip: "Sunday · 4:25 PM ET",
    spread: "BUF -2.5",
    total: "47.5",
    helix: 91,
    narrative: "20mph wind · Total dropping",
  },
  {
    id: "nyy-hou",
    home: { code: "HOU", name: "Astros", score: 2, logo: "⚾" },
    away: { code: "NYY", name: "Yankees", score: 3, logo: "⚾" },
    sport: "MLB",
    tip: "LIVE · Top 6",
    spread: "NYY -1.5",
    total: "8.5",
    helix: 87,
    narrative: "Cole locked in · 11 K through 5",
  },
];

export const aiModes = [
  { key: "research", label: "Research Analyst", desc: "Deep dive into matchup data, trends, and historicals." },
  { key: "risk", label: "Risk Manager", desc: "Bankroll exposure, correlation, hedge plays." },
  { key: "psych", label: "Market Psychology", desc: "Public vs sharp, narrative, recency bias." },
  { key: "prop", label: "Prop Specialist", desc: "Player props, hit rates, matchup difficulty." },
  { key: "weather", label: "Weather Analyst", desc: "Wind, precip, dome vs outdoor impact." },
  { key: "sharp", label: "Sharp Money Analyst", desc: "Steam, RLM, syndicate movement." },
  { key: "script", label: "Game Script Analyst", desc: "Pace, gameflow, garbage time risk." },
  { key: "narrative", label: "Narrative Analyst", desc: "Revenge, milestones, media noise." },
  { key: "sim", label: "Simulation Analyst", desc: "Run 10k+ Monte Carlo simulations." },
  { key: "card", label: "Card Builder", desc: "Auto-build research cards & shareables." },
];
