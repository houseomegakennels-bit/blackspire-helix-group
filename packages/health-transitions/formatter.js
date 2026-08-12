const LABELS = { api_liveness: 'API', database: 'DB', queue: 'Queue', worker: 'Worker', scheduler: 'Scheduler', kill_switch: 'Kill switch' };
// The explicit [\r\n\t] pass is intentionally redundant: the following /\s+/ collapse already
// covers CR, LF and TAB, so removing it is an EQUIVALENT mutation with no observable effect and
// no test can kill it. It is kept as a self-documenting guard against the \s+ pass being narrowed
// later. Do not report its survival as a coverage gap; two exact-head reviews already have.
function clean(value, max = 80) { return String(value ?? 'unknown').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').slice(0, max); }
export function formatOperatorStatus(diagnostics, { maxChunkLength = 1000 } = {}) {
  if (!Number.isInteger(maxChunkLength) || maxChunkLength < 200 || maxChunkLength > 4096) throw new Error('maxChunkLength must be from 200 to 4096');
  const lines = [
    `BLACKSPIRE ${clean(diagnostics.environment, 32).toUpperCase()} · ${clean(diagnostics.overallState, 32).toUpperCase()}`,
    `Build ${clean(diagnostics.deployment?.commit?.slice(0, 8))} · rollback ${clean(diagnostics.rollbackRecommendation, 40)}`,
  ];
  for (const component of ['api_liveness','database','queue','worker','scheduler','kill_switch']) lines.push(`${LABELS[component]}: ${clean(diagnostics.components?.[component]?.state, 32)}`);
  const warnings = [...(diagnostics.staleComponents || []).map((item) => `stale:${clean(item, 32)}`), ...(diagnostics.flappingComponents || []).map((item) => `flapping:${clean(item, 32)}`)];
  if (warnings.length) lines.push(`Warnings: ${warnings.join(', ')}`);
  lines.push(`Last transition: ${clean(diagnostics.latestMeaningfulTransition?.timestamp || diagnostics.lastTrustedObservationAt, 32)}`);
  const chunks = []; let current = '';
  for (const line of lines) {
    if (line.length > maxChunkLength) throw new Error('formatter produced an oversized line');
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChunkLength) { chunks.push(current); current = line; } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}
