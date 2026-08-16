import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MockSmsProvider } from '../src/modules/notifications/sms.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, randomIndianMobile } from './app.factory';

const letters = (count: number): string =>
  Array.from({ length: count }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]).join('');
const digits = (count: number): string =>
  Array.from({ length: count }, () => String(Math.floor(Math.random() * 10))).join('');
const uniquePan = (): string => `${letters(3)}P${letters(1)}${digits(4)}${letters(1)}`;

/** Date of birth for a given age, safely inside the year rather than on a boundary. */
const dobForAge = (age: number): string => {
  const now = new Date();
  return `${now.getUTCFullYear() - age}-01-01`;
};

const SOLVENT_PROFILE = {
  employmentType: 'SALARIED' as const,
  employerName: 'Example Employer Private Limited',
  workExperienceMonths: 36,
  monthlyIncome: '90000',
  existingMonthlyEmi: '0',
  residenceState: 'KARNATAKA',
  residencePincode: '560001',
  dateOfBirth: dobForAge(30),
};

describe('loan applications and decisioning (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let activeVersionId: string;
  let draftVersionId: string;

  const server = () => app.getHttpServer();

  const register = async (): Promise<{ token: string; userId: string }> => {
    const sms = app.get(MockSmsProvider);
    const phone = randomIndianMobile();
    await request(server()).post('/api/v1/auth/otp/send').send({ phone, purpose: 'REGISTRATION' }).expect(200);
    const message = sms.sent.filter((m) => m.to === phone).pop();
    if (!message) throw new Error('no OTP was dispatched');
    const { body } = await request(server())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: message.variables.code, device: { installationId: `app-${phone}` } })
      .expect(200);
    return { token: body.accessToken, userId: body.userId };
  };

  /** Registered, consented and identity-verified: the state a real applicant is in. */
  const applicant = async (): Promise<{ token: string; userId: string }> => {
    const user = await register();
    await request(server())
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${user.token}`)
      .send({
        decisions: [
          { purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true },
          { purposeCode: 'CREDIT_BUREAU_ENQUIRY', textVersion: 1, granted: true },
        ],
      })
      .expect(201);
    await request(server())
      .post('/api/v1/kyc/pan')
      .set('authorization', `Bearer ${user.token}`)
      .send({ pan: uniquePan(), name: 'Test Applicant', dateOfBirth: SOLVENT_PROFILE.dateOfBirth })
      .expect(200);
    return user;
  };

  const createApplication = async (
    token: string,
    overrides: Partial<{ productVersionId: string; amount: string; tenureMonths: number }> = {},
  ) => {
    const { body } = await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', randomUUID())
      .send({
        productVersionId: overrides.productVersionId ?? activeVersionId,
        amount: overrides.amount ?? '100000',
        tenureMonths: overrides.tenureMonths ?? 12,
        purposeCode: 'MEDICAL',
      })
      .expect(201);
    return body;
  };

  const putProfile = (token: string, id: string, overrides: Record<string, unknown> = {}) =>
    request(server())
      .put(`/api/v1/applications/${id}/profile`)
      .set('authorization', `Bearer ${token}`)
      .send({ ...SOLVENT_PROFILE, ...overrides });

  const submit = (token: string, id: string, key = randomUUID()) =>
    request(server())
      .post(`/api/v1/applications/${id}/submit`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

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
      data: { lenderId: lender.id, code: 'TEST_APP_PL', name: 'Test personal loan' },
    });
    const pricing = {
      minAmount: '10000.0000',
      maxAmount: '200000.0000',
      minTenureMonths: 3,
      maxTenureMonths: 24,
      interestMethodology: 'REDUCING_BALANCE' as const,
      annualRatePercent: '18.0000',
      processingFeePercent: '2.0000',
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

  it('approves a solvent, identity-verified applicant and records a reproducible decision', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    expect(created.status).toBe('DRAFT');
    expect(created.lender.legalName).toContain('TEST LENDER');

    const profiled = await putProfile(user.token, created.id).expect(200);
    expect(profiled.body.status).toBe('PROFILE_SUBMITTED');
    expect(profiled.body.profileComplete).toBe(true);

    const decided = await submit(user.token, created.id).expect(200);
    expect(decided.body.status).toBe('APPROVED');
    expect(decided.body.decision.outcome).toBe('APPROVE');
    expect(decided.body.decision.eligibleAmount).toBe('100000.00');
    expect(decided.body.decision.offeredRatePercent).toBe('18.0000');
    expect(decided.body.expiresAt).not.toBeNull();

    const stored = await prisma.riskDecision.findFirstOrThrow({
      where: { applicationId: created.id },
    });
    expect(stored.policyVersion).toBe('v1-dev');
    // The decision must be explainable and reproducible from what it stored.
    const inputs = stored.inputs as Record<string, unknown>;
    expect(inputs.monthlyIncome).toBe('90000');
    expect(inputs.eligibleAmount).toBe('100000.00');
    expect(inputs.identityVerified).toBe(true);
    expect(stored.foir?.toNumber()).toBeCloseTo(0.1019, 3);
    // Protected characteristics and document numbers must not reach the snapshot.
    const serialised = JSON.stringify(inputs);
    expect(serialised).not.toMatch(/gender|religion|caste|marital/i);
    expect(serialised).not.toContain('Example Employer');
  });

  it('caps the eligible amount at affordability rather than rejecting outright', async () => {
    const user = await applicant();
    const created = await createApplication(user.token, { amount: '150000', tenureMonths: 12 });
    await putProfile(user.token, created.id, { monthlyIncome: '30000', existingMonthlyEmi: '5000' }).expect(200);

    const decided = await submit(user.token, created.id).expect(200);
    expect(decided.body.status).toBe('APPROVED');
    const codes = decided.body.decision.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('ELIGIBLE_AMOUNT_BELOW_REQUEST');
    // ₹10,000 of monthly capacity at 18% over 12 months is well under the request.
    expect(Number(decided.body.decision.eligibleAmount)).toBeLessThan(150000);
    expect(Number(decided.body.decision.eligibleAmount)).toBeGreaterThan(0);
  });

  it('rejects an applicant whose obligations exhaust the FOIR ceiling', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    await putProfile(user.token, created.id, { monthlyIncome: '40000', existingMonthlyEmi: '30000' }).expect(200);

    const decided = await submit(user.token, created.id).expect(200);
    expect(decided.body.status).toBe('REJECTED');
    const codes = decided.body.decision.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('FOIR_EXCEEDED');
    expect(decided.body.decision.eligibleAmount).toBeNull();
  });

  it('rejects when identity is not verified, and says so', async () => {
    const user = await register();
    await request(server())
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${user.token}`)
      .send({
        decisions: [
          { purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true },
          { purposeCode: 'CREDIT_BUREAU_ENQUIRY', textVersion: 1, granted: true },
        ],
      })
      .expect(201);

    const created = await createApplication(user.token);
    await putProfile(user.token, created.id).expect(200);
    const decided = await submit(user.token, created.id).expect(200);

    expect(decided.body.status).toBe('REJECTED');
    const codes = decided.body.decision.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('KYC_NOT_VERIFIED');
  });

  it('rejects when the borrower would exceed the maximum age before maturity', async () => {
    const user = await applicant();
    const created = await createApplication(user.token, { tenureMonths: 24 });
    // 57 today, 59 at maturity, against a product maximum of 58.
    await putProfile(user.token, created.id, { dateOfBirth: dobForAge(57) }).expect(200);

    const decided = await submit(user.token, created.id).expect(200);
    expect(decided.body.status).toBe('REJECTED');
    const codes = decided.body.decision.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('AGE_ABOVE_MAXIMUM');
  });

  it('refers instead of auto-approving when declared income is large and unverified', async () => {
    const user = await applicant();
    const created = await createApplication(user.token, { amount: '200000', tenureMonths: 24 });
    await putProfile(user.token, created.id, { monthlyIncome: '400000' }).expect(200);

    const decided = await submit(user.token, created.id).expect(200);
    expect(decided.body.status).toBe('REFERRED');
    const codes = decided.body.decision.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('UNVERIFIED_INCOME_REFERRAL');
  });

  it('refuses straight-through approval when the device fails integrity attestation', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    await putProfile(user.token, created.id).expect(200);
    // Attestation is a signal, not a verdict: a failing device blocks automatic
    // approval but does not by itself decide the application.
    await prisma.device.updateMany({
      where: { userId: user.userId },
      data: { integrityVerdict: 'FAILED' },
    });

    const decided = await submit(user.token, created.id).expect(200);
    expect(decided.body.status).toBe('REFERRED');
    const stored = await prisma.riskDecision.findFirstOrThrow({ where: { applicationId: created.id } });
    expect(stored.fraudSignals).toContain('DEVICE_INTEGRITY_FAILED');
    expect(stored.fraudScore).toBeGreaterThan(0);
    // The customer is not told which rule fired.
    const messages = decided.body.decision.reasons.map((r: { message: string }) => r.message).join(' ');
    expect(messages).not.toMatch(/device|integrity|fraud/i);
  });

  it('cannot be decided twice: a replayed submission returns the first decision', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    await putProfile(user.token, created.id).expect(200);

    const key = randomUUID();
    const first = await submit(user.token, created.id, key).expect(200);
    const replay = await submit(user.token, created.id, key).expect(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.decision.decidedAt).toBe(first.body.decision.decidedAt);

    // A fresh key must not produce a second decision either.
    const again = await submit(user.token, created.id).expect(409);
    expect(again.body.error.code).toBe('APPLICATION_INVALID_TRANSITION');
    expect(await prisma.riskDecision.count({ where: { applicationId: created.id } })).toBe(1);
  });

  it('refuses concurrent submissions of the same application', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    await putProfile(user.token, created.id).expect(200);

    const results = await Promise.all([
      submit(user.token, created.id),
      submit(user.token, created.id),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.riskDecision.count({ where: { applicationId: created.id } })).toBe(1);
  });

  it('refuses to submit without a financial profile', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    const response = await submit(user.token, created.id).expect(409);
    expect(response.body.error.code).toBe('APPLICATION_PROFILE_REQUIRED');
  });

  it('refuses a second live application while one is in progress', async () => {
    const user = await applicant();
    await createApplication(user.token);
    const response = await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', randomUUID())
      .send({ productVersionId: activeVersionId, amount: '50000', tenureMonths: 12, purposeCode: 'TRAVEL' })
      .expect(409);
    expect(response.body.error.code).toBe('APPLICATION_ALREADY_IN_PROGRESS');
  });

  it('allows a withdrawal, and then refuses any further change', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    const withdrawn = await request(server())
      .post(`/api/v1/applications/${created.id}/withdraw`)
      .set('authorization', `Bearer ${user.token}`)
      .send({ reason: 'Changed my mind' })
      .expect(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');

    const edit = await putProfile(user.token, created.id).expect(409);
    expect(edit.body.error.code).toBe('APPLICATION_NOT_EDITABLE');
    const again = await request(server())
      .post(`/api/v1/applications/${created.id}/withdraw`)
      .set('authorization', `Bearer ${user.token}`)
      .send({ reason: 'Again' })
      .expect(409);
    expect(again.body.error.code).toBe('APPLICATION_INVALID_TRANSITION');
  });

  it('expires an approval whose validity has elapsed rather than honouring it', async () => {
    const user = await applicant();
    const created = await createApplication(user.token);
    await putProfile(user.token, created.id).expect(200);
    await submit(user.token, created.id).expect(200);

    await prisma.loanApplication.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const { body } = await request(server())
      .get(`/api/v1/applications/${created.id}`)
      .set('authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(body.status).toBe('EXPIRED');
    const history = await prisma.applicationStatusHistory.findMany({
      where: { applicationId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual([
      'DRAFT',
      'PROFILE_SUBMITTED',
      'UNDER_REVIEW',
      'APPROVED',
      'EXPIRED',
    ]);
  });

  it('refuses a draft product version and an amount outside the product limits', async () => {
    const user = await applicant();
    const draft = await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', randomUUID())
      .send({ productVersionId: draftVersionId, amount: '50000', tenureMonths: 12, purposeCode: 'MEDICAL' })
      .expect(404);
    expect(draft.body.error.code).toBe('NOT_FOUND');

    const tooLarge = await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', randomUUID())
      .send({ productVersionId: activeVersionId, amount: '999999', tenureMonths: 12, purposeCode: 'MEDICAL' })
      .expect(400);
    expect(tooLarge.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects malformed input, a free-text purpose and a client-claimed verification strength', async () => {
    const user = await applicant();
    await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', randomUUID())
      .send({ productVersionId: activeVersionId, amount: '50000.001', tenureMonths: 12, purposeCode: 'MEDICAL' })
      .expect(400);
    await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', randomUUID())
      .send({ productVersionId: activeVersionId, amount: '50000', tenureMonths: 12, purposeCode: 'SOMETHING ELSE' })
      .expect(400);

    const created = await createApplication(user.token);
    // A client must not be able to assert that its income is bank-verified.
    await putProfile(user.token, created.id, { incomeVerification: 'BANK_STATEMENT' }).expect(400);
    await putProfile(user.token, created.id, { residencePincode: '56001' }).expect(400);
    await putProfile(user.token, created.id, { dateOfBirth: '01-01-1990' }).expect(400);
  });

  it('requires an idempotency key to create or submit', async () => {
    const user = await applicant();
    const response = await request(server())
      .post('/api/v1/applications')
      .set('authorization', `Bearer ${user.token}`)
      .send({ productVersionId: activeVersionId, amount: '50000', tenureMonths: 12, purposeCode: 'MEDICAL' })
      .expect(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('requires credit assessment consent before financial details are collected', async () => {
    const user = await register();
    await request(server())
      .post('/api/v1/consents')
      .set('authorization', `Bearer ${user.token}`)
      .send({ decisions: [{ purposeCode: 'IDENTITY_VERIFICATION', textVersion: 1, granted: true }] })
      .expect(201);
    const created = await createApplication(user.token);

    const response = await putProfile(user.token, created.id).expect(403);
    expect(response.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('never exposes another customer\u2019s application', async () => {
    const owner = await applicant();
    const other = await applicant();
    const created = await createApplication(owner.token);

    const response = await request(server())
      .get(`/api/v1/applications/${created.id}`)
      .set('authorization', `Bearer ${other.token}`)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication', async () => {
    await request(server()).get('/api/v1/applications').expect(401);
    await request(server()).post('/api/v1/applications').send({}).expect(401);
  });
});
