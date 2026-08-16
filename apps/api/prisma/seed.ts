/**
 * Development seed. Refuses to run against production.
 *
 * The lender and product below are placeholders for local development only.
 * They are NOT a real regulated lender and the pricing is NOT an approved
 * product: real lender identity, licence reference, grievance contacts and
 * pricing must come from the executed lender agreement and be loaded through
 * the admin product-approval flow.
 */
import { FeeCollection, InterestMethodology, PrismaClient, ProductStatus } from '@prisma/client';

const prisma = new PrismaClient();

const PURPOSES = [
  {
    code: 'IDENTITY_VERIFICATION',
    title: 'Verify your identity',
    description: 'Used to confirm who you are before a loan can be offered, as required for lending.',
    dataCategories: ['name', 'date_of_birth', 'government_id_number', 'address', 'photo'],
    required: true,
    body:
      'We will verify your identity using the government ID details you provide, through a verification provider acting on our and the lender\u2019s behalf. We store only the identity data needed to originate and service your loan.',
  },
  {
    code: 'CREDIT_BUREAU_ENQUIRY',
    title: 'Check your credit information',
    description: 'Allows the lender to obtain your credit information to assess your application.',
    dataCategories: ['name', 'government_id_number', 'phone', 'credit_history'],
    required: true,
    body:
      'You authorise the lender to obtain your credit information report from a credit information company for the purpose of assessing this loan application and, if a loan is granted, for servicing it.',
  },
  {
    code: 'BANK_ACCOUNT_VERIFICATION',
    title: 'Verify your bank account',
    description: 'Confirms the account that a loan would be disbursed to and repaid from.',
    dataCategories: ['bank_account_number', 'ifsc', 'account_holder_name'],
    required: true,
    body:
      'We verify that the bank account you provide belongs to you before any disbursement is made. Disbursement is only ever made to a verified account in your name.',
  },
  {
    code: 'MARKETING_COMMUNICATION',
    title: 'Receive offers and product updates',
    description: 'Optional. Declining this does not affect your application in any way.',
    dataCategories: ['phone', 'email'],
    required: false,
    body:
      'You may receive information about products and offers. This is entirely optional, you can withdraw it at any time, and your loan application and pricing do not depend on it.',
  },
] as const;

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development seed must never be run against production.');
  }

  for (const purpose of PURPOSES) {
    await prisma.consentPurpose.upsert({
      where: { code: purpose.code },
      create: {
        code: purpose.code,
        title: purpose.title,
        description: purpose.description,
        dataCategories: [...purpose.dataCategories],
        required: purpose.required,
      },
      update: {
        title: purpose.title,
        description: purpose.description,
        dataCategories: [...purpose.dataCategories],
        required: purpose.required,
      },
    });

    const existing = await prisma.consentText.findUnique({
      where: { purposeCode_version_locale: { purposeCode: purpose.code, version: 1, locale: 'en-IN' } },
    });
    if (!existing) {
      await prisma.consentText.create({
        data: {
          purposeCode: purpose.code,
          version: 1,
          locale: 'en-IN',
          body: purpose.body,
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        },
      });
    }
  }

  const lender = await prisma.lender.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      legalName: 'DEVELOPMENT PLACEHOLDER LENDER — NOT A REAL LENDER',
      brandName: 'Dev Placeholder Lender',
      licenseType: 'UNVERIFIED_PLACEHOLDER',
      licenseReference: 'UNVERIFIED_PLACEHOLDER',
      grievanceOfficerName: 'Development placeholder',
      grievanceEmail: 'grievance@example.invalid',
      grievancePhone: '+910000000000',
      status: 'ONBOARDING',
    },
    update: {},
  });

  const product = await prisma.loanProduct.upsert({
    where: { lenderId_code: { lenderId: lender.id, code: 'DEV_PERSONAL_LOAN' } },
    create: { lenderId: lender.id, code: 'DEV_PERSONAL_LOAN', name: 'Development personal loan' },
    update: {},
  });

  const versionExists = await prisma.loanProductVersion.findUnique({
    where: { productId_version: { productId: product.id, version: 1 } },
  });
  if (!versionExists) {
    await prisma.loanProductVersion.create({
      data: {
        productId: product.id,
        version: 1,
        minAmount: '10000.0000',
        maxAmount: '200000.0000',
        minTenureMonths: 3,
        maxTenureMonths: 24,
        interestMethodology: InterestMethodology.REDUCING_BALANCE,
        annualRatePercent: '18.0000',
        processingFeePercent: '2.0000',
        processingFeeMin: '500.0000',
        processingFeeMax: '5000.0000',
        taxOnFeesPercent: '18.0000',
        feeCollection: FeeCollection.DEDUCT_FROM_DISBURSEMENT,
        latePaymentFeePercent: '2.0000',
        latePaymentGraceDays: 3,
        allocationOrder: ['PENALTY', 'FEES', 'INTEREST', 'PRINCIPAL'],
        coolingOffDays: 3,
        minAgeYears: 21,
        maxAgeYears: 58,
        minMonthlyIncome: '15000.0000',
        allowedStates: [],
        // Stays DRAFT: an ACTIVE product implies approved, contracted pricing.
        status: ProductStatus.DRAFT,
        effectiveFrom: new Date(),
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seeded consent purposes and a DRAFT placeholder development product.');
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
