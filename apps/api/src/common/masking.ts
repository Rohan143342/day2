/**
 * Sensitive values are masked at the point of logging, not left to reviewer
 * discipline. `logSafe` walks an object and masks anything whose key is known
 * to carry identity, financial, or authentication data.
 */
const MASK_KEYS = new Set([
  'phone',
  'phonenumber',
  'mobile',
  'otp',
  'code',
  'codehash',
  'pan',
  'aadhaar',
  'accountnumber',
  'account',
  'ifsc',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'dob',
  'dateofbirth',
  'email',
  'name',
  'address',
]);

export const maskTail = (value: string, visible = 4): string => {
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visible) + value.slice(-visible);
};

export const maskEmail = (value: string): string => {
  const [local, domain] = value.split('@');
  if (!domain) return maskTail(value, 0);
  return `${local.slice(0, 1)}***@${domain}`;
};

export const logSafe = (input: unknown, depth = 0): unknown => {
  if (depth > 6 || input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => logSafe(item, depth + 1));
  if (typeof input !== 'object') return input;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (MASK_KEYS.has(normalized)) {
      if (typeof value === 'string') {
        output[key] = normalized === 'email' ? maskEmail(value) : maskTail(value);
      } else {
        output[key] = '[REDACTED]';
      }
      continue;
    }
    output[key] = logSafe(value, depth + 1);
  }
  return output;
};
