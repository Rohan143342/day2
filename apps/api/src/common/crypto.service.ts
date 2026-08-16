import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Field-level encryption and keyed hashing.
 *
 * In production the data key is supplied by KMS (envelope encryption) and the
 * key id is stored alongside the ciphertext so keys can be rotated without
 * re-encrypting everything at once. Keys are never read from source.
 */
@Injectable()
export class CryptoService {
  private readonly dataKey: Buffer;
  private readonly blindIndexKey: Buffer;
  private readonly otpPepper: Buffer;

  constructor(config: ConfigService) {
    this.dataKey = Buffer.from(config.getOrThrow<string>('FIELD_ENCRYPTION_KEY'), 'base64');
    this.blindIndexKey = Buffer.from(config.getOrThrow<string>('BLIND_INDEX_KEY'), 'base64');
    this.otpPepper = Buffer.from(config.getOrThrow<string>('OTP_PEPPER'), 'base64');
    if (this.dataKey.length !== 32 || this.blindIndexKey.length !== 32) {
      throw new Error('FIELD_ENCRYPTION_KEY and BLIND_INDEX_KEY must each be 32 bytes, base64 encoded');
    }
  }

  /** AES-256-GCM. Output layout: v1:<iv>:<authTag>:<ciphertext>, all base64. */
  encryptField(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(
      ':',
    );
  }

  decryptField(payload: string): string {
    const [version, iv, authTag, ciphertext] = payload.split(':');
    if (version !== 'v1' || !iv || !authTag || !ciphertext) {
      throw new Error('unsupported ciphertext envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.dataKey, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  /**
   * Deterministic keyed digest so an encrypted column stays searchable by exact
   * match without being decryptable from the index alone.
   */
  blindIndex(value: string): string {
    return createHmac('sha256', this.blindIndexKey).update(value.trim().toLowerCase()).digest('hex');
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.blindIndexKey).update(token).digest('hex');
  }

  /** Numeric OTP from a CSPRNG. Never derived from a timestamp or sequence. */
  generateOtp(digits = 6): string {
    const max = 10 ** digits;
    return randomInt(0, max).toString().padStart(digits, '0');
  }

  hashOtp(code: string, userId: string): string {
    return scryptSync(`${userId}:${code}`, this.otpPepper, 32).toString('hex');
  }

  verifyOtp(code: string, userId: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashOtp(code, userId), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
