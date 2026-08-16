import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MockSmsProvider } from '../src/modules/notifications/sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, randomIndianMobile } from './app.factory';

describe('products and quotes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let activeVersionId: string;
  let draftVersionId: string;

  const login = async (): Promise<string> => {
    const sms = app.get(MockSmsProvider);
    const phone = randomIndianMobile();
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone, purpose: 'REGISTRATION' })
      .expect(200);
    const message = sms.sent.filter((m) => m.to === phone).pop();
    if (!message) throw new Error('no OTP was dispatched');
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: message.variables.code, device: { installationId: 'products-install-01' } })
      .expect(200);
    return response.body.accessToken;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    accessToken = await login();

    await request(app.getHttpServer())
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ decisions: [{ purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true }] })
      .expect(201);

    const lender = await prisma.lender.create({
      data: {
        legalName: `TEST LENDER ${randomUUID()}`,
        brandName: 'Test Lender',
        licenseType: 'TEST',
        licenseReference: 'TEST',
        grievanceOfficerName: 'Test',
        grievanceEmail: 'test@example.invalid',
        grievancePhone: '+910000000000',
        status: 'ACTIVE',
      },
    });
    const product = await prisma.loanProduct.create({
      data: { lenderId: lender.id, code: 'TEST_PL', name: 'Test personal loan' },
    });
    const pricing = {
      minAmount: '10000.0000',
      maxAmount: '200000.0000',
      minTenureMonths: 3,
      maxTenureMonths: 24,
      interestMethodology: 'REDUCING_BALANCE' as const,
      annualRatePercent: '18.0000',
      processingFeePercent: '2.0000',
      processingFeeMin: '500.0000',
      processingFeeMax: '5000.0000',
      taxOnFeesPercent: '18.0000',
      feeCollection: 'DEDUCT_FROM_DISBURSEMENT' as const,
      latePaymentFeePercent: '2.0000',
      latePaymentGraceDays: 3,
      allocationOrder: ['PENALTY', 'FEES', 'INTEREST', 'PRINCIPAL'],
      coolingOffDays: 3,
      minAgeYears: 21,
      maxAgeYears: 58,
      minMonthlyIncome: '15000.0000',
      allowedStates: [],
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    };
    activeVersionId = (
      await prisma.loanProductVersion.create({
        data: { ...pricing, productId: product.id, version: 1, status: 'ACTIVE' },
      })
    ).id;
    draftVersionId = (
      await prisma.loanProductVersion.create({
        data: { ...pricing, productId: product.id, version: 2, status: 'DRAFT' },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only active products, each naming its lender of record', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/v1/products')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    const ids = body.map((p: { productVersionId: string }) => p.productVersionId);
    expect(ids).toContain(activeVersionId);
    expect(ids).not.toContain(draftVersionId);
    const offered = body.find((p: { productVersionId: string }) => p.productVersionId === activeVersionId);
    expect(offered.lender.legalName).toContain('TEST LENDER');
  });

  it('computes a quote whose disclosed totals are internally consistent', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/products/quote')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ productVersionId: activeVersionId, amount: '100000', tenureMonths: 12 })
      .expect(200);

    // 18% reducing balance over 12 months on ₹1,00,000.
    expect(body.emi).toBe('9168.00');
    expect(body.processingFee).toBe('2000.00');
    expect(body.taxOnFee).toBe('360.00');
    expect(body.netDisbursed).toBe('97640.00');
    expect(body.schedule).toHaveLength(12);

    const sumOfInstallments = body.schedule.reduce(
      (total: number, i: { totalDue: string }) => total + Number(i.totalDue),
      0,
    );
    expect(sumOfInstallments.toFixed(2)).toBe(body.totalPayable);
    expect(Number(body.totalCostOfCredit).toFixed(2)).toBe(
      (Number(body.totalInterest) + Number(body.processingFee) + Number(body.taxOnFee)).toFixed(2),
    );
    // Rounding residue must land in the schedule, not in the customer's balance.
    expect(body.schedule[11].closingPrincipal).toBe('0.00');
    // APR on the net amount received must exceed the headline interest rate once
    // an upfront fee has been deducted.
    expect(Number(body.aprPercent)).toBeGreaterThan(18);
  });

  it('refuses to quote a product that is not offered', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/products/quote')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ productVersionId: draftVersionId, amount: '50000', tenureMonths: 12 })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/products/quote')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ productVersionId: randomUUID(), amount: '50000', tenureMonths: 12 })
      .expect(404);
  });

  it('enforces the configured amount and tenure bands', async () => {
    for (const payload of [
      { amount: '9999', tenureMonths: 12 },
      { amount: '200001', tenureMonths: 12 },
      { amount: '50000', tenureMonths: 2 },
      { amount: '50000', tenureMonths: 25 },
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/products/quote')
        .set('authorization', `Bearer ${accessToken}`)
        .send({ productVersionId: activeVersionId, ...payload })
        .expect(400);
    }
  });

  it('rejects a sub-paisa amount rather than silently rounding it', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/products/quote')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ productVersionId: activeVersionId, amount: '50000.123', tenureMonths: 12 })
      .expect(400);
  });

  it('requires identity consent before quoting', async () => {
    const freshToken = await login();
    const response = await request(app.getHttpServer())
      .post('/api/v1/products/quote')
      .set('authorization', `Bearer ${freshToken}`)
      .send({ productVersionId: activeVersionId, amount: '50000', tenureMonths: 12 })
      .expect(403);
    expect(response.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/products').expect(401);
  });
});
