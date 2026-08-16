/**
 * Startup-time configuration validation. The process refuses to boot with an
 * incomplete or unsafe configuration rather than discovering it mid-request.
 *
 * The mock provider rule is deliberate: a production deployment must never be
 * able to fall back to a simulated SMS, KYC or payment provider, because a
 * simulated provider would produce financial or identity outcomes that never
 * actually happened.
 */
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  FIELD_ENCRYPTION_KEY: string;
  BLIND_INDEX_KEY: string;
  OTP_PEPPER: string;
  SMS_PROVIDER: string;
  KYC_PROVIDER: string;
  SWAGGER_ENABLED: boolean;
}

const MOCKABLE_PROVIDERS = ['SMS_PROVIDER', 'KYC_PROVIDER'] as const;

const required = (env: Record<string, unknown>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
};

const int = (env: Record<string, unknown>, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
};

export const validateEnv = (env: Record<string, unknown>): AppEnv => {
  const nodeEnv = (env.NODE_ENV as AppEnv['NODE_ENV']) ?? 'development';
  if (!['development', 'test', 'staging', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development, test, staging or production`);
  }

  const jwtSecret = required(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  const validated: AppEnv = {
    NODE_ENV: nodeEnv,
    PORT: int(env, 'PORT', 3000),
    DATABASE_URL: required(env, 'DATABASE_URL'),
    JWT_SECRET: jwtSecret,
    JWT_ISSUER: (env.JWT_ISSUER as string) ?? 'lending-platform',
    ACCESS_TOKEN_TTL_SECONDS: int(env, 'ACCESS_TOKEN_TTL_SECONDS', 600),
    REFRESH_TOKEN_TTL_DAYS: int(env, 'REFRESH_TOKEN_TTL_DAYS', 30),
    FIELD_ENCRYPTION_KEY: required(env, 'FIELD_ENCRYPTION_KEY'),
    BLIND_INDEX_KEY: required(env, 'BLIND_INDEX_KEY'),
    OTP_PEPPER: required(env, 'OTP_PEPPER'),
    SMS_PROVIDER: required(env, 'SMS_PROVIDER'),
    KYC_PROVIDER: required(env, 'KYC_PROVIDER'),
    SWAGGER_ENABLED: String(env.SWAGGER_ENABLED ?? nodeEnv !== 'production') === 'true',
  };

  if (nodeEnv === 'production') {
    for (const key of MOCKABLE_PROVIDERS) {
      if (validated[key].toLowerCase() === 'mock') {
        throw new Error(`${key}=mock is not permitted when NODE_ENV=production`);
      }
    }
  }

  return validated;
};
