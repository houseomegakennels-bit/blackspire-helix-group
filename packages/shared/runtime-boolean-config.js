const PRODUCTION_BOOLEAN_CONFIG = Object.freeze({
  SECURE_COOKIES: Object.freeze({ required: true, requiredValue: true }),
  DEBUG: Object.freeze({ required: true, requiredValue: false }),
  RATE_LIMIT_DISABLED: Object.freeze({ required: true, requiredValue: false }),
  TRUST_PROXY: Object.freeze({ required: true }),
  GIT_WORKFLOW_ENABLED: Object.freeze({ required: true }),
  UNIFIED_IPHONE_TEST_MODE: Object.freeze({ required: false, requiredValue: false }),
  ALLOW_BEARER_AUTH: Object.freeze({ required: false }),
  BLACKSPIRE_RUN_MIGRATIONS: Object.freeze({ required: false }),
});

export function configuredBoolean(name, env = process.env, { required = false } = {}) {
  const raw = env[name];
  if (raw === undefined && !required) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new TypeError(`${name} must be explicitly set to "true" or "false"${required ? '' : ' when configured'}.`);
}

export function validateProductionBooleanConfig(env = process.env) {
  const errors = [];
  for (const [name, rule] of Object.entries(PRODUCTION_BOOLEAN_CONFIG)) {
    try {
      const value = configuredBoolean(name, env, rule);
      if (value !== undefined && Object.hasOwn(rule, 'requiredValue') && value !== rule.requiredValue) {
        errors.push(`${name} must be ${String(rule.requiredValue)} in the approved production profile.`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}
