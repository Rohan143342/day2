/**
 * Test configuration. Keys here are throwaway values generated for the test
 * process only; no real key material is ever committed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) loadEnv({ path: envFile });

process.env.NODE_ENV = 'test';
process.env.SMS_PROVIDER = 'mock';
process.env.KYC_PROVIDER = 'mock';
process.env.SWAGGER_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? randomBytes(32).toString('hex');
process.env.FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY ?? randomBytes(32).toString('base64');
process.env.BLIND_INDEX_KEY = process.env.BLIND_INDEX_KEY ?? randomBytes(32).toString('base64');
process.env.OTP_PEPPER = process.env.OTP_PEPPER ?? randomBytes(32).toString('base64');
