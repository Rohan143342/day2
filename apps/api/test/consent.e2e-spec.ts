import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MockSmsProvider } from '../src/modules/notifications/sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, randomIndianMobile } from './app.factory';

const device = { installationId: 'consent-installation-01' };

describe('consent (e2e)', () => {
  let app: INestApplication;
  let sms: MockSmsProvider;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    sms = app.get(MockSmsProvider);
    prisma = app.get(PrismaService);

    const phone = randomIndianMobile();
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone, purpose: 'REGISTRATION' })
      .expect(200);
    const message = sms.sent.filter((m) => m.to === phone).pop();
    if (!message) throw new Error('no OTP was dispatched');
    const code = message.variables.code;
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code, device })
      .expect(200);
    accessToken = login.body.accessToken;
    userId = login.body.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => request(app.getHttpServer());

  it('lists seeded purposes with wording, categories, and an unanswered state', async () => {
    const { body } = await auth()
      .get('/api/v1/consents')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    const identity = body.find((p: { code: string }) => p.code === 'IDENTITY_VERIFICATION');
    expect(identity.required).toBe(true);
    expect(identity.currentState).toBe('NOT_ANSWERED');
    expect(identity.body.length).toBeGreaterThan(20);
    expect(identity.dataCategories).toContain('government_id_number');

    const marketing = body.find((p: { code: string }) => p.code === 'MARKETING_COMMUNICATION');
    expect(marketing.required).toBe(false);
  });

  it('records per-purpose decisions, including a declined optional purpose', async () => {
    await auth()
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        decisions: [
          { purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true },
          { purposeCode: 'CREDIT_BUREAU_ENQUIRY', textVersion: 1, granted: true },
          { purposeCode: 'MARKETING_COMMUNICATION', textVersion: 1, granted: false },
        ],
      })
      .expect(201);

    const { body } = await auth()
      .get('/api/v1/consents')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    const state = (code: string) => body.find((p: { code: string }) => p.code === code).currentState;
    expect(state('IDENTITY_VERIFICATION')).toBe('GRANTED');
    expect(state('MARKETING_COMMUNICATION')).toBe('DECLINED');
    expect(state('BANK_ACCOUNT_VERIFICATION')).toBe('NOT_ANSWERED');

    const stored = await prisma.consent.findMany({ where: { userId } });
    expect(stored).toHaveLength(3);
    expect(stored.every((c) => c.textVersion === 1 && c.ipHash)).toBe(true);
  });

  it('rejects a decision against an unknown text version', async () => {
    const response = await auth()
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ decisions: [{ purposeCode: 'IDENTITY_VERIFICATION', textVersion: 99, granted: true }] })
      .expect(409);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects duplicate purposes in a single submission', async () => {
    await auth()
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        decisions: [
          { purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true },
          { purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: false },
        ],
      })
      .expect(400);
  });

  it('withdraws a granted consent without deleting the original record', async () => {
    const { body } = await auth()
      .post('/api/v1/consents/withdraw')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ purposeCode: 'CREDIT_BUREAU_ENQUIRY', reason: 'no longer required' })
      .expect(200);
    expect(body.withdrawnAt).toBeTruthy();

    const rows = await prisma.consent.findMany({ where: { userId, purposeCode: 'CREDIT_BUREAU_ENQUIRY' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].granted).toBe(true);
    expect(rows[0].withdrawnAt).not.toBeNull();

    await auth()
      .post('/api/v1/consents/withdraw')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ purposeCode: 'CREDIT_BUREAU_ENQUIRY', reason: 'again' })
      .expect(404);
  });

  it('writes an audit row and an outbox event for every consent change', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { actorId: userId, action: { in: ['CONSENT_RECORDED', 'CONSENT_WITHDRAWN'] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.every((a) => a.correlationId.length > 0)).toBe(true);

    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: userId } });
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['ConsentRecorded', 'ConsentWithdrawn']),
    );
  });

  it('requires authentication', async () => {
    await auth().get('/api/v1/consents').expect(401);
  });
});
