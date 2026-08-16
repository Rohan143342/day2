import { EmploymentType } from '@prisma/client';

/**
 * Credit policy, versioned and immutable.
 *
 * Every decision stores the version it ran under, so a decision taken today can
 * still be explained after the policy changes. Editing a published version is
 * forbidden — add a new one.
 *
 * COMPLIANCE: the thresholds below are development defaults. A live policy must
 * be signed off by the lender of record (and its credit committee) before any
 * customer is decisioned against it.
 *
 * Deliberately absent as decision variables: religion, caste, gender, marital
 * status, or any proxy for them. They are not collected anywhere in this system.
 */
export interface CreditPolicy {
  version: string;
  /** Maximum share of monthly income that may go to debt, including this loan. */
  maxFoir: string;
  minWorkExperienceMonths: Record<EmploymentType, number>;
  /** Declared-only income above this amount goes to manual review, not straight through. */
  unverifiedIncomeReferralAmount: string;
  fraud: {
    /** At or above this score the application is refused. */
    rejectAtScore: number;
    /** At or above this score a human must look at it. */
    referAtScore: number;
  };
  /** How long an approval stays actionable before it must be re-decisioned. */
  approvalValidityHours: number;
}

export const CREDIT_POLICY_V1: CreditPolicy = {
  version: 'v1-dev',
  maxFoir: '0.50',
  minWorkExperienceMonths: {
    SALARIED: 6,
    SELF_EMPLOYED: 24,
    BUSINESS_OWNER: 24,
  },
  unverifiedIncomeReferralAmount: '200000',
  fraud: { rejectAtScore: 70, referAtScore: 40 },
  approvalValidityHours: 72,
};

export const ACTIVE_CREDIT_POLICY = CREDIT_POLICY_V1;

/**
 * Reason codes are the decision. Customer-facing wording is derived from them,
 * so an explanation can never drift from what the engine actually did.
 */
export const ReasonCode = {
  WITHIN_POLICY: 'WITHIN_POLICY',
  KYC_NOT_VERIFIED: 'KYC_NOT_VERIFIED',
  AGE_BELOW_MINIMUM: 'AGE_BELOW_MINIMUM',
  AGE_ABOVE_MAXIMUM: 'AGE_ABOVE_MAXIMUM',
  INCOME_BELOW_MINIMUM: 'INCOME_BELOW_MINIMUM',
  FOIR_EXCEEDED: 'FOIR_EXCEEDED',
  INSUFFICIENT_WORK_EXPERIENCE: 'INSUFFICIENT_WORK_EXPERIENCE',
  STATE_NOT_SERVICED: 'STATE_NOT_SERVICED',
  ELIGIBLE_AMOUNT_BELOW_PRODUCT_MINIMUM: 'ELIGIBLE_AMOUNT_BELOW_PRODUCT_MINIMUM',
  ELIGIBLE_AMOUNT_BELOW_REQUEST: 'ELIGIBLE_AMOUNT_BELOW_REQUEST',
  UNVERIFIED_INCOME_REFERRAL: 'UNVERIFIED_INCOME_REFERRAL',
  FRAUD_RISK_HIGH: 'FRAUD_RISK_HIGH',
  FRAUD_RISK_MODERATE: 'FRAUD_RISK_MODERATE',
} as const;

export type ReasonCodeValue = (typeof ReasonCode)[keyof typeof ReasonCode];

/**
 * Wording shown to the customer per reason code. Fraud codes map to a neutral
 * message on purpose: telling an applicant which fraud rule fired teaches them
 * how to defeat it.
 */
export const REASON_CODE_MESSAGES: Record<ReasonCodeValue, string> = {
  WITHIN_POLICY: 'Your application meets the lending criteria.',
  KYC_NOT_VERIFIED: 'Your identity verification is not complete.',
  AGE_BELOW_MINIMUM: 'You do not meet the minimum age for this product.',
  AGE_ABOVE_MAXIMUM: 'You do not meet the maximum age for this product.',
  INCOME_BELOW_MINIMUM: 'Your declared monthly income is below the minimum for this product.',
  FOIR_EXCEEDED: 'Your existing monthly obligations are too high for this instalment.',
  INSUFFICIENT_WORK_EXPERIENCE: 'You do not meet the minimum employment history for this product.',
  STATE_NOT_SERVICED: 'This product is not available in your state yet.',
  ELIGIBLE_AMOUNT_BELOW_PRODUCT_MINIMUM:
    'The amount you are eligible for is below the minimum for this product.',
  ELIGIBLE_AMOUNT_BELOW_REQUEST: 'You are eligible for a lower amount than you requested.',
  UNVERIFIED_INCOME_REFERRAL: 'We need to verify your income before we can proceed.',
  FRAUD_RISK_HIGH: 'We are unable to proceed with this application.',
  FRAUD_RISK_MODERATE: 'Your application needs a manual review.',
};
