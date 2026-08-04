export const RUNTIME_INTEGER_CONFIG = Object.freeze({
  EVIDENCE_BUNDLE_MAX_BYTES: rule(500_000, 1, 10_000_000, 10_000),
  CLEANUP_INTERVAL_MS: rule(900_000, 1, 3_600_000, 60_000),
  TELEGRAM_FILE_MAX_BYTES: rule(2_000_000, 1, 20_000_000, 1_024),
  TELEGRAM_INLINE_MAX_CHARS: rule(3_500, 1, 3_900, 1),
  WORKER_POLL_MS: rule(750, 1, 60_000, 100),
  APPROVAL_TTL_MS: rule(1_800_000, 1, 604_800_000, 60_000),
  HERMES_TIMEOUT_MS: rule(30_000, 1, 600_000, 1_000),
  TELEGRAM_OUTBOX_MAX_ATTEMPTS: rule(3, 1, 20, 1),
  TELEGRAM_OUTBOX_RETRY_SECONDS: rule(30, 0, 3_600, 1),
  UNIFIED_TEST_TTL_MS: rule(7_200_000, 60_000, 14_400_000, 60_000),
});

function rule(defaultValue, min, max, productionMin) {
  return Object.freeze({ defaultValue, min, max, productionMin });
}

export function configuredInteger(name, env = process.env) {
  const config = RUNTIME_INTEGER_CONFIG[name];
  if (!config) throw new TypeError(`Unknown integer configuration key: ${name}`);
  const raw = env[name];
  if (raw === undefined) return config.defaultValue;
  if (raw === '') throw new TypeError(`${name} must not be empty when configured.`);
  const encoded = String(raw);
  if (!/^(0|[1-9][0-9]*)$/.test(encoded)) {
    throw new TypeError(`${name} must be a canonical decimal integer with no whitespace, sign, exponent, or leading zero.`);
  }
  const value = Number(encoded);
  const min = env.NODE_ENV === 'production' ? config.productionMin : config.min;
  if (!Number.isSafeInteger(value) || value < min || value > config.max) {
    throw new TypeError(`${name} must be an integer from ${min} through ${config.max}.`);
  }
  return value;
}

export function validateProductionIntegerConfig(env = process.env) {
  const productionEnv = { ...env, NODE_ENV: 'production' };
  const errors = [];
  for (const name of Object.keys(RUNTIME_INTEGER_CONFIG)) {
    try { configuredInteger(name, productionEnv); } catch (error) { errors.push(error.message); }
  }
  return errors;
}
