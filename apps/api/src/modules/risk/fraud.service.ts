import { Injectable } from '@nestjs/common';
import { ApplicationStatus, IncomeVerificationMethod, KycStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fraud signals are weighted observations, never verdicts on their own. Each has
 * a stable code so a decision can be explained, and the weights are the only
 * thing tuned in future — the codes stay comparable across time.
 *
 * Device attestation is treated as a signal only. A client can lie about it, so
 * it can lower trust but never establish it.
 */
export const FraudSignal = {
  APPLICATION_VELOCITY_USER: 'APPLICATION_VELOCITY_USER',
  SHARED_DEVICE_INSTALLATION: 'SHARED_DEVICE_INSTALLATION',
  KYC_FAILURE_VELOCITY: 'KYC_FAILURE_VELOCITY',
  KYC_MANUAL_REVIEW_PENDING: 'KYC_MANUAL_REVIEW_PENDING',
  DEVICE_INTEGRITY_FAILED: 'DEVICE_INTEGRITY_FAILED',
  UNVERIFIED_INCOME_HIGH_AMOUNT: 'UNVERIFIED_INCOME_HIGH_AMOUNT',
} as const;

export type FraudSignalValue = (typeof FraudSignal)[keyof typeof FraudSignal];

const WEIGHTS: Record<FraudSignalValue, number> = {
  APPLICATION_VELOCITY_USER: 25,
  SHARED_DEVICE_INSTALLATION: 40,
  KYC_FAILURE_VELOCITY: 30,
  KYC_MANUAL_REVIEW_PENDING: 20,
  // On its own enough to reach the referral threshold: an app running on a
  // rooted, emulated or tampered device must not be approved automatically.
  DEVICE_INTEGRITY_FAILED: 40,
  UNVERIFIED_INCOME_HIGH_AMOUNT: 15,
};

export interface FraudAssessment {
  score: number;
  signals: FraudSignalValue[];
}

@Injectable()
export class FraudService {
  private static readonly VELOCITY_WINDOW_HOURS = 24;
  private static readonly MAX_APPLICATIONS_PER_WINDOW = 3;
  private static readonly MAX_KYC_FAILURES_PER_WINDOW = 3;

  constructor(private readonly prisma: PrismaService) {}

  async assess(params: {
    userId: string;
    applicationId: string;
    deviceId?: string | null;
    requestedAmount: string;
    incomeVerification: IncomeVerificationMethod;
    unverifiedIncomeThreshold: string;
  }): Promise<FraudAssessment> {
    const since = new Date(Date.now() - FraudService.VELOCITY_WINDOW_HOURS * 60 * 60 * 1000);
    const signals: FraudSignalValue[] = [];

    const recentApplications = await this.prisma.loanApplication.count({
      where: {
        userId: params.userId,
        createdAt: { gte: since },
        id: { not: params.applicationId },
        status: { notIn: [ApplicationStatus.WITHDRAWN] },
      },
    });
    if (recentApplications >= FraudService.MAX_APPLICATIONS_PER_WINDOW) {
      signals.push(FraudSignal.APPLICATION_VELOCITY_USER);
    }

    const kycRows = await this.prisma.kycVerification.findMany({
      where: { userId: params.userId },
      select: { status: true, createdAt: true },
    });
    const recentFailures = kycRows.filter(
      (row) => row.status === KycStatus.FAILED && row.createdAt >= since,
    ).length;
    if (recentFailures >= FraudService.MAX_KYC_FAILURES_PER_WINDOW) {
      signals.push(FraudSignal.KYC_FAILURE_VELOCITY);
    }
    if (kycRows.some((row) => row.status === KycStatus.MANUAL_REVIEW)) {
      signals.push(FraudSignal.KYC_MANUAL_REVIEW_PENDING);
    }

    if (params.deviceId) {
      const device = await this.prisma.device.findUnique({ where: { id: params.deviceId } });
      if (device) {
        if (device.integrityVerdict && device.integrityVerdict.toUpperCase() !== 'PASS') {
          signals.push(FraudSignal.DEVICE_INTEGRITY_FAILED);
        }
        // The same app installation appearing under several accounts is a strong
        // signal: one physical handset is being used to farm applications.
        const accountsOnInstallation = await this.prisma.device.findMany({
          where: { installationId: device.installationId },
          select: { userId: true },
          distinct: ['userId'],
        });
        if (accountsOnInstallation.length >= 3) {
          signals.push(FraudSignal.SHARED_DEVICE_INSTALLATION);
        }
      }
    }

    if (
      params.incomeVerification === IncomeVerificationMethod.DECLARED &&
      Number(params.requestedAmount) >= Number(params.unverifiedIncomeThreshold)
    ) {
      signals.push(FraudSignal.UNVERIFIED_INCOME_HIGH_AMOUNT);
    }

    const score = Math.min(
      100,
      signals.reduce((total, signal) => total + WEIGHTS[signal], 0),
    );
    return { score, signals };
  }
}
