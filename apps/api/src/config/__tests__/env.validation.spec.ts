import { randomBytes } from 'node:crypto';
import { validateEnv } from '../env.validation';

const base = (): Record<string, string> => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/lending',
  JWT_SECRET: randomBytes(32).toString('hex'),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
  OTP_PEPPER: randomBytes(32).toString('base64'),
  SMS_PROVIDER: 'mock',
  KYC_PROVIDER: 'mock',
});

describe('validateEnv', () => {
  it('accepts a complete development configuration', () => {
    expect(validateEnv(base()).PORT).toBe(3000);
  });

  it('fails fast when a required value is missing', () => {
    const env = base();
    delete env.DATABASE_URL;
    expect(() => validateEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...base(), JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it.each(['SMS_PROVIDER', 'KYC_PROVIDER'])('refuses to start production on a mock %s', (key) => {
    expect(() =>
      validateEnv({ ...base(), NODE_ENV: 'production', [key]: 'mock' }),
    ).toThrow(/not permitted when NODE_ENV=production/);
  });

  it('allows a real provider in production', () => {
    expect(
      validateEnv({
        ...base(),
        NODE_ENV: 'production',
        SMS_PROVIDER: 'gateway',
        KYC_PROVIDER: 'vendor',
      }).SWAGGER_ENABLED,
    ).toBe(false);
  });

  it('rejects a non-numeric port', () => {
    expect(() => validateEnv({ ...base(), PORT: 'abc' })).toThrow(/PORT/);
  });
});
