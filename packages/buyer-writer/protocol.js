import { createHash, timingSafeEqual } from 'node:crypto';

// Protocol boundary only. This module is not mounted in the API and grants no
// database authority. A transactional store must separately verify the permit,
// persisted owner, expiry, generation, receipts and provenance before writing.
export class WriterProtocolError extends Error {
  constructor(status) {
    super(status === 503 ? 'Buyer writer unavailable' : 'Buyer writer request rejected');
    this.name = 'WriterProtocolError';
    this.status = status;
  }
}

const reject = (status = 400) => { throw new WriterProtocolError(status); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const uuid = (value) => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

// The HTTP adapter must reject duplicate credential headers using rawHeaders
// before calling this function; Node otherwise coalesces some duplicate headers.
// No environment or credential files are loaded implicitly.
export function authenticateWriter({ headers, expectedCredential }) {
  if (!opaque(expectedCredential)) reject(503);
  const supplied = headers?.['x-buyer-writer-key'];
  const permit = headers?.['x-buyer-job-permit'];
  if (!opaque(supplied) || !opaque(permit)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedCredential))) reject(401);
  // Matching the workload credential is not a job authorization decision.
  return { permitDigest: digest(permit) };
}

function object(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
}

function exactKeys(value, keys) {
  object(value);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) reject();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const saleTextFields = [
  'buyer_name', 'seller_name', 'property_address', 'mailing_address',
  'property_type', 'parcel_id', 'deed_type', 'lender_name',
];
const saleFields = [...saleTextFields, 'sale_price', 'sale_date'];

function validateSale(row) {
  exactKeys(row, saleFields);
  for (const field of saleTextFields) {
    if (row[field] !== null && (typeof row[field] !== 'string' || row[field].length > 512
        || /[\u0000-\u001f\u007f]/u.test(row[field]))) reject();
  }
  if (row.sale_price !== null && (typeof row.sale_price !== 'number'
      || !Number.isFinite(row.sale_price) || row.sale_price < 0 || row.sale_price > 1e12)) reject();
  if (row.sale_date !== null) {
    if (typeof row.sale_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)
        || row.sale_date.startsWith('0000-')) reject();
    const date = new Date(`${row.sale_date}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.sale_date) reject();
  }
}

export function parseWriterOperation({ jobId, body }) {
  if (!Buffer.isBuffer(body)) reject();
  if (body.length > 256 * 1024) reject(413);
  if (!uuid(jobId)) reject();
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch { reject(); }
  exactKeys(value, ['version', 'dispatchId', 'generation', 'operation', 'chunkIndex', 'chunkCount', 'payload']);
  if (value.version !== 1 || !uuid(value.dispatchId)
      || !integer(value.generation, 1, Number.MAX_SAFE_INTEGER)
      || !integer(value.chunkCount, 1, 500)
      || !integer(value.chunkIndex, 0, value.chunkCount - 1)) reject();
  const append = value.operation === 'raw.append' || value.operation === 'clean.append';
  if (append) {
    exactKeys(value.payload, ['rows']);
    if (!Array.isArray(value.payload.rows) || value.payload.rows.length < 1 || value.payload.rows.length > 100) reject();
    for (const row of value.payload.rows) validateSale(row);
  } else {
    if (value.chunkIndex !== 0 || value.chunkCount !== 1) reject();
    if (value.operation === 'fail') {
      exactKeys(value.payload, ['code']);
      if (!['NO_DATA_SOURCE', 'SOURCE_FAILED', 'INVALID_SOURCE_DATA'].includes(value.payload.code)) reject();
    } else if (['start', 'buyers.commit', 'complete'].includes(value.operation)) {
      // The database derives profile facts and completion counts from committed
      // job sales. No externally supplied scores or existing profile IDs.
      exactKeys(value.payload, []);
    } else reject();
  }
  const normalized = { jobId, ...value };
  return { ...normalized, payloadDigest: digest(canonical(normalized)) };
}
