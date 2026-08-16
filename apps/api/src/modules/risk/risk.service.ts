import { Injectable } from '@nestjs/common';
import {
  ApplicantProfile,
  DecisionOutcome,
  KycStatus,
  LoanProductVersion,
  Prisma,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { Money, affordableInstallment, equatedInstallment, foir, maxPrincipalForInstallment } from '@lending/money';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_CREDIT_POLICY, ReasonCode, ReasonCodeValue } from './policy';
import { FraudService } from './fraud.service';

export interface RiskDecisionResult {
  policyVersion: string;
  outcome: DecisionOutcome;
  reasonCodes: ReasonCodeValue[];
  eligibleAmount: Money | null;
  eligibleTenureMonths: number | null;
  offeredRatePercent: Decimal | null;
  foir: Decimal | null;
  fraudScore: number;
  fraudSignals: string[];
  inputs: Prisma.InputJsonValue;
}

/**
 * Deterministic rule-based credit decisioning, kept out of the HTTP layer so the
 * same evaluation can be re-run offline against a stored input snapshot.
 *
 * NOT YET INCLUDED, and required before a live launch: credit bureau enquiry,
 * bank-statement based income verification, and any behavioural/ML scoring. Their
 * absence is why this policy is marked development-only rather than silently
 * approving on thin data.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fraud: FraudService,
  ) {}

  async decide(params: {
    userId: string;
    applicationId: string;
    deviceId?: string | null;
    profile: ApplicantProfile;
    version: LoanProductVersion;
    requestedAmount: Decimal;
    requestedTenureMonths: number;
  }): Promise<RiskDecisionResult> {
    const policy = ACTIVE_CREDIT_POLICY;
    const { profile, version } = params;
    const reasonCodes: ReasonCodeValue[] = [];

    const identityVerified = await this.prisma.kycVerification.findFirst({
      where: { userId: params.userId, status: KycStatus.VERIFIED },
    });
    if (!identityVerified) reasonCodes.push(ReasonCode.KYC_NOT_VERIFIED);

    if (profile.ageYears < version.minAgeYears) reasonCodes.push(ReasonCode.AGE_BELOW_MINIMUM);
    // Age is checked at maturity, not at application: the borrower must be inside
    // the band for the whole term, not just on the day they apply.
    const ageAtMaturity = profile.ageYears + Math.ceil(params.requestedTenureMonths / 12);
    if (ageAtMaturity > version.maxAgeYears) reasonCodes.push(ReasonCode.AGE_ABOVE_MAXIMUM);

    const monthlyIncome = Money.fromMajor(profile.monthlyIncome.toString());
    const existingEmi = Money.fromMajor(profile.existingMonthlyEmi.toString());
    if (profile.monthlyIncome.lessThan(version.minMonthlyIncome)) {
      reasonCodes.push(ReasonCode.INCOME_BELOW_MINIMUM);
    }

    const minExperience = policy.minWorkExperienceMonths[profile.employmentType];
    if (profile.workExperienceMonths < minExperience) {
      reasonCodes.push(ReasonCode.INSUFFICIENT_WORK_EXPERIENCE);
    }

    if (
      version.allowedStates.length > 0 &&
      !version.allowedStates.includes(profile.residenceState.toUpperCase())
    ) {
      reasonCodes.push(ReasonCode.STATE_NOT_SERVICED);
    }

    // Affordability drives the amount: capacity left under the FOIR ceiling is
    // converted into the largest principal whose instalment fits inside it.
    const capacity = monthlyIncome.isPositive()
      ? affordableInstallment({
          monthlyIncome,
          existingObligations: existingEmi,
          maxFoir: policy.maxFoir,
        })
      : Money.zero();
    const affordablePrincipal = maxPrincipalForInstallment({
      maxInstallment: capacity,
      annualRatePercent: version.annualRatePercent.toString(),
      tenureMonths: params.requestedTenureMonths,
      methodology: version.interestMethodology,
    });

    const requested = Money.fromMajor(params.requestedAmount.toString());
    const productMax = Money.fromMajor(version.maxAmount.toString());
    const productMin = Money.fromMajor(version.minAmount.toString());
    const eligibleAmount = requested.min(affordablePrincipal).min(productMax);

    if (capacity.isZero()) {
      reasonCodes.push(ReasonCode.FOIR_EXCEEDED);
    } else if (eligibleAmount.lessThan(productMin)) {
      reasonCodes.push(ReasonCode.ELIGIBLE_AMOUNT_BELOW_PRODUCT_MINIMUM);
    } else if (eligibleAmount.lessThan(requested)) {
      // Not a rejection: a smaller amount is still an approvable outcome, and the
      // customer must be told the figure changed rather than shown their request.
      reasonCodes.push(ReasonCode.ELIGIBLE_AMOUNT_BELOW_REQUEST);
    }

    const proposedInstallment = eligibleAmount.isPositive()
      ? equatedInstallment(
          eligibleAmount,
          version.annualRatePercent.toString(),
          params.requestedTenureMonths,
        )
      : Money.zero();
    const resultingFoir = monthlyIncome.isPositive()
      ? foir({ monthlyIncome, existingObligations: existingEmi, proposedInstallment })
      : null;

    const fraud = await this.fraud.assess({
      userId: params.userId,
      applicationId: params.applicationId,
      deviceId: params.deviceId,
      requestedAmount: params.requestedAmount.toString(),
      incomeVerification: profile.incomeVerification,
      unverifiedIncomeThreshold: policy.unverifiedIncomeReferralAmount,
    });
    if (fraud.score >= policy.fraud.rejectAtScore) reasonCodes.push(ReasonCode.FRAUD_RISK_HIGH);
    else if (fraud.score >= policy.fraud.referAtScore) reasonCodes.push(ReasonCode.FRAUD_RISK_MODERATE);

    if (
      profile.incomeVerification === 'DECLARED' &&
      params.requestedAmount.greaterThanOrEqualTo(policy.unverifiedIncomeReferralAmount)
    ) {
      reasonCodes.push(ReasonCode.UNVERIFIED_INCOME_REFERRAL);
    }

    const outcome = this.outcomeFor(reasonCodes);
    const approved = outcome === DecisionOutcome.APPROVE;

    return {
      policyVersion: policy.version,
      outcome,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : [ReasonCode.WITHIN_POLICY],
      eligibleAmount: approved ? eligibleAmount : null,
      eligibleTenureMonths: approved ? params.requestedTenureMonths : null,
      offeredRatePercent: approved ? new Decimal(version.annualRatePercent.toString()) : null,
      foir: resultingFoir,
      fraudScore: fraud.score,
      fraudSignals: fraud.signals,
      // Snapshot of exactly what the policy saw. No document numbers, no employer
      // name, no protected characteristics — enough to reproduce, nothing more.
      inputs: {
        policyVersion: policy.version,
        productVersionId: version.id,
        requestedAmount: params.requestedAmount.toString(),
        requestedTenureMonths: params.requestedTenureMonths,
        ageYears: profile.ageYears,
        ageAtMaturity,
        employmentType: profile.employmentType,
        workExperienceMonths: profile.workExperienceMonths,
        monthlyIncome: profile.monthlyIncome.toString(),
        existingMonthlyEmi: profile.existingMonthlyEmi.toString(),
        incomeVerification: profile.incomeVerification,
        residenceState: profile.residenceState,
        identityVerified: Boolean(identityVerified),
        affordableInstallment: capacity.toMajorString(),
        affordablePrincipal: affordablePrincipal.toMajorString(),
        eligibleAmount: eligibleAmount.toMajorString(),
        proposedInstallment: proposedInstallment.toMajorString(),
        foir: resultingFoir?.toFixed(4) ?? null,
        fraudScore: fraud.score,
        fraudSignals: fraud.signals,
      },
    };
  }

  /** Any hard code rejects; referral codes send it to a human; otherwise approve. */
  private outcomeFor(reasonCodes: ReasonCodeValue[]): DecisionOutcome {
    const rejecting: ReasonCodeValue[] = [
      ReasonCode.KYC_NOT_VERIFIED,
      ReasonCode.AGE_BELOW_MINIMUM,
      ReasonCode.AGE_ABOVE_MAXIMUM,
      ReasonCode.INCOME_BELOW_MINIMUM,
      ReasonCode.FOIR_EXCEEDED,
      ReasonCode.INSUFFICIENT_WORK_EXPERIENCE,
      ReasonCode.STATE_NOT_SERVICED,
      ReasonCode.ELIGIBLE_AMOUNT_BELOW_PRODUCT_MINIMUM,
      ReasonCode.FRAUD_RISK_HIGH,
    ];
    const referring: ReasonCodeValue[] = [
      ReasonCode.FRAUD_RISK_MODERATE,
      ReasonCode.UNVERIFIED_INCOME_REFERRAL,
    ];
    if (reasonCodes.some((code) => rejecting.includes(code))) return DecisionOutcome.REJECT;
    if (reasonCodes.some((code) => referring.includes(code))) return DecisionOutcome.REFER;
    return DecisionOutcome.APPROVE;
  }
}
