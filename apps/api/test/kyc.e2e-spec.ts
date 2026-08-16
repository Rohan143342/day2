import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MockKycProvider } from '../src/modules/kyc/mock-kyc.provider';
import { MockSmsProvider } from '../src/modules/notifications/sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, randomIndianMobile } from './app.factory';

const letters = (count: number): string =>
  Array.from({ length: count }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]).join('');
const digits = (count: number): string =>
  Array.from({ length: count }, () => String(Math.floor(Math.random() * 10))).join('');

/**
 * Individual PAN: five letters with 'P' fourth, four digits, one letter. Values
 * are random because verified documents persist across runs by design.
 */
const uniquePan = (): string => `${letters(3)}P${letters(1)}${digits(4)}${letters(1)}`;
const uniqueAadhaar = (): string => `${digits(1).replace(/[01]/, '9')}${digits(11)}`;

describe('kyc (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const register = async (): Promise<{ token: string; userId: string }> => {
    const sms = app.get(MockSmsProvider);
    const phone = randomIndianMobile();
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone, purpose: 'REGISTRATION' })
      .expect(200);
    const message = sms.sent.filter((m) => m.to === phone).pop();
    if (!message) throw new Error('no OTP was dispatched');
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: message.variables.code, device: { installationId: `kyc-${phone}` } })
      .expect(200);
    return { token: body.accessToken, userId: body.userId };
  };

  const consented = async (): Promise<{ token: string; userId: string }> => {
    const user = await register();
    await request(app.getHttpServer())
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${user.token}`)
      .send({ decisions: [{ purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true }] })
      .expect(201);
    return user;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses KYC before identity consent is granted', async () => {
    const user = await register();
    const response = await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan: uniquePan(), name: 'Test User', dateOfBirth: '1990-01-01' })
      .expect(403);
    expect(response.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('verifies a PAN and stores the number encrypted, never in the clear', async () => {
    const user = await consented();
    const pan = uniquePan();
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan, name: 'Test User', dateOfBirth: '1990-01-01' })
      .expect(200);

    expect(body.status).toBe('VERIFIED');
    expect(body.documentLast4).toBe(pan.slice(-4));
    expect(JSON.stringify(body)).not.toContain(pan.slice(0, 6));

    const row = await prisma.kycVerification.findUniqueOrThrow({ where: { id: body.verificationId } });
    expect(row.documentNumberEncrypted).not.toContain(pan);
    expect(row.providerName).toBe('mock');
    expect(row.providerReference).toBeTruthy();
    expect(row.nameEncrypted).not.toContain('Test User');
    expect(row.verifiedAt).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: 'kyc_verification', resourceId: row.id, action: 'KYC_VERIFIED' },
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.newValue)).not.toContain(pan.slice(0, 6));
  });

  it('keeps a failed attempt on record instead of discarding it', async () => {
    const user = await consented();
    const response = await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan: 'ZZZZZ1234Z', name: 'Test User', dateOfBirth: '1990-01-01' })
      .expect(422);
    expect(response.body.error.code).toBe('KYC_VERIFICATION_FAILED');

    const rows = await prisma.kycVerification.findMany({ where: { userId: user.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('FAILED');
    expect(rows[0].failureCode).toBe('DOCUMENT_NOT_FOUND');
    expect(rows[0].verifiedAt).toBeNull();
  });

  it('routes a name mismatch to manual review rather than approving or rejecting it', async () => {
    const user = await consented();
    await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan: uniquePan(), name: 'MISMATCH User', dateOfBirth: '1990-01-01' })
      .expect(422);

    const row = await prisma.kycVerification.findFirstOrThrow({ where: { userId: user.userId } });
    expect(row.status).toBe('MANUAL_REVIEW');
    expect(row.failureCode).toBe('NAME_MISMATCH');
  });

  it('rejects a document already verified under another account', async () => {
    const first = await consented();
    const pan = uniquePan();
    await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${first.token}`)
      .send({ pan, name: 'Test User', dateOfBirth: '1990-01-01' })
      .expect(200);

    const second = await consented();
    const response = await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${second.token}`)
      .send({ pan, name: 'Test User', dateOfBirth: '1992-05-05' })
      .expect(409);
    expect(response.body.error.code).toBe('KYC_DOCUMENT_ALREADY_USED');

    const flagged = await prisma.auditLog.findFirst({
      where: { action: 'KYC_DOCUMENT_REUSE_DETECTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(flagged).toBeTruthy();
  });

  it('will not re-verify an already verified method', async () => {
    const user = await consented();
    await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan: uniquePan(), name: 'Test User', dateOfBirth: '1990-01-01' })
      .expect(200);
    const response = await request(app.getHttpServer())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan: uniquePan(), name: 'Test User', dateOfBirth: '1990-01-01' })
      .expect(409);
    expect(response.body.error.code).toBe('KYC_ALREADY_VERIFIED');
  });

  it('completes the offline-Aadhaar OTP flow and rejects a wrong code', async () => {
    const user = await consented();
    const aadhaar = uniqueAadhaar();
    const initiated = await request(app.getHttpServer())
      .post('/api/v1/kyc/aadhaar/otp')
      .set('authorization', `Bearer ${user.token}`)
      .send({ aadhaar })
      .expect(200);
    expect(initiated.body.status).toBe('AWAITING_OTP');

    const wrong = await request(app.getHttpServer())
      .post('/api/v1/kyc/aadhaar/verify')
      .set('authorization', `Bearer ${user.token}`)
      .send({ verificationId: initiated.body.verificationId, otp: '000000' })
      .expect(422);
    expect(wrong.body.error.code).toBe('KYC_VERIFICATION_FAILED');

    const verified = await request(app.getHttpServer())
      .post('/api/v1/kyc/aadhaar/verify')
      .set('authorization', `Bearer ${user.token}`)
      .send({
        verificationId: initiated.body.verificationId,
        otp: MockKycProvider.MOCK_AADHAAR_OTP,
      })
      .expect(404);
    // A failed OTP closes the challenge; the customer must request a new one
    // rather than keep guessing against the same reference.
    expect(verified.body.error.code).toBe('KYC_CHALLENGE_NOT_FOUND');

    const row = await prisma.kycVerification.findUniqueOrThrow({
      where: { id: initiated.body.verificationId },
    });
    expect(row.documentNumberEncrypted).not.toContain(aadhaar);
    expect(row.documentLast4).toBe(aadhaar.slice(-4));
  });

  it('releases Aadhaar identity data only with the correct OTP', async () => {
    const user = await consented();
    const initiated = await request(app.getHttpServer())
      .post('/api/v1/kyc/aadhaar/otp')
      .set('authorization', `Bearer ${user.token}`)
      .send({ aadhaar: uniqueAadhaar() })
      .expect(200);

    const { body } = await request(app.getHttpServer())
      .post('/api/v1/kyc/aadhaar/verify')
      .set('authorization', `Bearer ${user.token}`)
      .send({
        verificationId: initiated.body.verificationId,
        otp: MockKycProvider.MOCK_AADHAAR_OTP,
      })
      .expect(200);
    expect(body.status).toBe('VERIFIED');
    expect(body.name).toBeTruthy();

    const status = await request(app.getHttpServer())
      .get('/api/v1/kyc/status')
      .set('authorization', `Bearer ${user.token}`)
      .expect(200);
    const aadhaarStatus = status.body.find(
      (s: { method: string }) => s.method === 'AADHAAR_OFFLINE_XML',
    );
    expect(aadhaarStatus.status).toBe('VERIFIED');
    expect(JSON.stringify(status.body)).not.toContain('documentNumber');
  });

  it('rejects a malformed PAN, Aadhaar and OTP at the edge', async () => {
    const user = await consented();
    const cases: [string, object][] = [
      ['/api/v1/kyc/pan', { pan: 'notapan', name: 'Test User', dateOfBirth: '1990-01-01' }],
      ['/api/v1/kyc/pan', { pan: uniquePan(), name: 'Test User', dateOfBirth: '01-01-1990' }],
      ['/api/v1/kyc/aadhaar/otp', { aadhaar: '1234' }],
      ['/api/v1/kyc/aadhaar/verify', { verificationId: 'x', otp: 'abcdef' }],
    ];
    for (const [path, payload] of cases) {
      await request(app.getHttpServer())
        .post(path)
        .set('authorization', `Bearer ${user.token}`)
        .send(payload)
        .expect(400);
    }
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/kyc/status').expect(401);
  });
});
