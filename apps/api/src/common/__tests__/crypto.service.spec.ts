import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../crypto.service';

const configWith = (overrides: Record<string, string> = {}): ConfigService => {
  const values: Record<string, string> = {
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
    OTP_PEPPER: randomBytes(32).toString('base64'),
    ...overrides,
  };
  return {
    getOrThrow: (key: string): string => {
      const value = values[key];
      if (!value) throw new Error(`missing ${key}`);
      return value;
    },
  } as unknown as ConfigService;
};

describe('CryptoService', () => {
  const crypto = new CryptoService(configWith());

  it('round-trips an encrypted field', () => {
    const ciphertext = crypto.encryptField('+919876543210');
    expect(ciphertext).not.toContain('9876543210');
    expect(crypto.decryptField(ciphertext)).toBe('+919876543210');
  });

  it('produces a different ciphertext each time for the same plaintext', () => {
    expect(crypto.encryptField('+919876543210')).not.toBe(crypto.encryptField('+919876543210'));
  });

  it('rejects tampered ciphertext instead of returning wrong plaintext', () => {
    const ciphertext = crypto.encryptField('+919876543210');
    const parts = ciphertext.split(':');
    const payload = Buffer.from(parts[3], 'base64');
    payload[0] ^= 0xff;
    parts[3] = payload.toString('base64');
    expect(() => crypto.decryptField(parts.join(':'))).toThrow();
  });

  it('makes blind indexes deterministic so exact lookup works without decryption', () => {
    expect(crypto.blindIndex('+919876543210')).toBe(crypto.blindIndex('+919876543210'));
    expect(crypto.blindIndex('+919876543210')).not.toBe(crypto.blindIndex('+919876543211'));
  });

  it('scopes blind indexes to the configured key', () => {
    const other = new CryptoService(configWith({ BLIND_INDEX_KEY: randomBytes(32).toString('base64') }));
    expect(other.blindIndex('+919876543210')).not.toBe(crypto.blindIndex('+919876543210'));
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new CryptoService(configWith({ BLIND_INDEX_KEY: Buffer.alloc(16).toString('base64') }))).toThrow(
      /32 bytes/,
    );
  });

  it('generates six-digit OTPs and verifies them only for the same user', () => {
    const code = crypto.generateOtp();
    expect(code).toMatch(/^\d{6}$/);
    const hash = crypto.hashOtp(code, 'user-a');
    expect(hash).not.toContain(code);
    expect(crypto.verifyOtp(code, 'user-a', hash)).toBe(true);
    expect(crypto.verifyOtp(code, 'user-b', hash)).toBe(false);
    expect(crypto.verifyOtp('000000', 'user-a', hash)).toBe(false);
  });

  it('hashes tokens deterministically and irreversibly', () => {
    const token = crypto.randomToken();
    expect(crypto.hashToken(token)).toBe(crypto.hashToken(token));
    expect(crypto.hashToken(token)).not.toContain(token);
  });
});
