// Hermes task classifier (Milestone 1 — deterministic, keyword-based).
//
// Classifies a NormalizedTask by domain, risk, complexity, urgency, and required capabilities. It is
// intentionally deterministic (no model call) so Milestone 1 is fully testable and reproducible, and
// so classification can never itself become an untrusted-model injection surface. Milestone 3 may add
// a model-assisted classifier behind the same output contract.

const HIGH_RISK = /\b(deploy|delete|drop|force[- ]?push|prod(uction)?|secret|credential|token|merge|payment|fund|wire|transfer)\b/i;
const CODE = /\b(fix|refactor|implement|patch|code|function|bug|test|build|compile)\b/i;
const DOC = /\b(doc(ument|s)?|readme|write[- ]?up|note|summary)\b/i;
const URGENT = /\b(urgent|asap|immediately|now|critical|outage|down)\b/i;

/**
 * @typedef {Object} Classification
 * @property {'status'|'documentation'|'code'|'general'} domain
 * @property {'low'|'medium'|'high'} risk
 * @property {'trivial'|'moderate'|'complex'} complexity
 * @property {'low'|'normal'|'high'} urgency
 * @property {string[]} requiredCapabilities
 */

/** @param {{objective:string}} normalized @returns {Classification} */
export function classifyTask(normalized) {
  const text = String(normalized?.objective || '');
  const words = text.split(/\s+/).filter(Boolean).length;

  let domain = 'general';
  const requiredCapabilities = [];
  if (CODE.test(text)) { domain = 'code'; requiredCapabilities.push('code.edit'); }
  else if (DOC.test(text)) { domain = 'documentation'; requiredCapabilities.push('doc.edit'); }
  else if (/\b(status|report|health|state|summar)/i.test(text)) { domain = 'status'; requiredCapabilities.push('status.report'); }
  if (requiredCapabilities.length === 0) requiredCapabilities.push('status.report');

  const risk = HIGH_RISK.test(text) ? 'high' : domain === 'code' ? 'medium' : 'low';
  const complexity = words > 60 ? 'complex' : words > 15 ? 'moderate' : 'trivial';
  const urgency = URGENT.test(text) ? 'high' : 'normal';

  return { domain, risk, complexity, urgency, requiredCapabilities };
}
