import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { KycMethod, KycStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { AppException, ErrorCode } from '../../common/errors';
import { OutboxService } from '../../common/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import {
  KYC_PROVIDER,
  KycProvider,
  KycProviderResult,
  VerifiedIdentity,
} from './kyc.provider';

export interface KycStatusView {
  method: KycMethod;
  status: KycStatus;
  verifiedAt: string | null;
  /** Only the last four digits of a verified document are ever returned. */
  documentLast4: string | null;
  failureCode: string | null;
  attemptsRemaining: number;
}

/** Identity attributes released to the client after a successful verification. */
export interface KycResultView {
  verificationId: string;
  status: KycStatus;
  method: KycMethod;
  documentLast4: string | null;
  name?: string;
  dateOfBirth?: string;
}

/**
 * KYC orchestration.
 *
 * The platform never decides that an identity is genuine: it asks a provider,
 * records the verdict with the provider name and reference, and stores only the
 * attributes it needs — encrypted, with a blind index so the same document
 * appearing under two customers can be detected without decrypting anything.
 *
 * Failed attempts are retained and capped. A verified record is never silently
 * replaced by a later attempt.
 */
@Injectable()
export class KycService {
  private static readonly MAX_ATTEMPTS_PER_METHOD = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly consent: ConsentService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
  ) {}

  async status(userId: string): Promise<KycStatusView[]> {
    const rows = await this.prisma.kycVerification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return Object.values(KycMethod).map((method) => {
      const forMethod = rows.filter((row) => row.method === method);
      const verified = forMethod.find((row) => row.status === KycStatus.VERIFIED);
      const latest = verified ?? forMethod[0];
      return {
        method,
        status: latest?.status ?? KycStatus.INITIATED,
        verifiedAt: latest?.verifiedAt?.toISOString() ?? null,
        documentLast4: latest?.documentLast4 ?? null,
        failureCode: verified ? null : (latest?.failureCode ?? null),
        attemptsRemaining: Math.max(0, KycService.MAX_ATTEMPTS_PER_METHOD - forMethod.length),
      };
    });
  }

  async verifyPan(
    userId: string,
    input: { pan: string; name: string; dateOfBirth: string },
    meta: { ip?: string },
  ): Promise<KycResultView> {
    await this.consent.assertGranted(userId, ['IDENTITY_VERIFICATION']);
    const pan = input.pan.toUpperCase();
    await this.assertMethodOpen(userId, KycMethod.PAN);
    await this.assertDocumentUnused(userId, pan);

    const result = await this.callProvider(() =>
      this.provider.verifyPan({ pan, claimedName: input.name, dateOfBirth: input.dateOfBirth }),
    );

    const verification = await this.persist({
      userId,
      method: KycMethod.PAN,
      document: pan,
      result,
      meta,
    });

    if (result.outcome !== 'VERIFIED') {
      throw new AppException(
        ErrorCode.KYC_VERIFICATION_FAILED,
        result.outcome === 'MANUAL_REVIEW'
          ? 'We could not confirm your details automatically; this is being reviewed.'
          : 'We could not verify this PAN.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { verificationId: verification.id, failureCode: result.failureCode },
      );
    }

    return {
      verificationId: verification.id,
      status: verification.status,
      method: KycMethod.PAN,
      documentLast4: verification.documentLast4,
      name: result.identity.name,
      dateOfBirth: result.identity.dateOfBirth,
    };
  }

  async initiateAadhaar(
    userId: string,
    aadhaar: string,
    meta: { ip?: string },
  ): Promise<{ verificationId: string; status: KycStatus }> {
    await this.consent.assertGranted(userId, ['IDENTITY_VERIFICATION']);
    await this.assertMethodOpen(userId, KycMethod.AADHAAR_OFFLINE_XML);
    await this.assertDocumentUnused(userId, aadhaar);

    const { providerReference } = await this.callProvider(() =>
      this.provider.initiateAadhaarOtp({ aadhaar }),
    );

    const verification = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kycVerification.create({
        data: {
          userId,
          method: KycMethod.AADHAAR_OFFLINE_XML,
          status: KycStatus.AWAITING_OTP,
          providerName: this.provider.name,
          providerReference,
          documentNumberEncrypted: this.crypto.encryptField(aadhaar),
          documentBlindIndex: this.crypto.blindIndex(aadhaar),
          documentLast4: aadhaar.slice(-4),
          attempts: 0,
        },
      });
      await this.recordTrail(tx, userId, created.id, 'KYC_AADHAAR_OTP_REQUESTED', {
        provider: this.provider.name,
        // The Aadhaar number is never written to an audit or event payload.
        documentLast4: created.documentLast4,
        ipHash: this.crypto.blindIndex(meta.ip ?? ''),
      });
      return created;
    });

    return { verificationId: verification.id, status: verification.status };
  }

  async verifyAadhaarOtp(
    userId: string,
    input: { verificationId: string; otp: string },
  ): Promise<KycResultView> {
    const pending = await this.prisma.kycVerification.findFirst({
      where: {
        id: input.verificationId,
        userId,
        method: KycMethod.AADHAAR_OFFLINE_XML,
        status: KycStatus.AWAITING_OTP,
      },
    });
    if (!pending || !pending.providerReference) {
      throw new AppException(
        ErrorCode.KYC_CHALLENGE_NOT_FOUND,
        'This verification is no longer awaiting an OTP. Start again.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (pending.attempts + 1 > KycService.MAX_ATTEMPTS_PER_METHOD) {
      throw new AppException(
        ErrorCode.KYC_ATTEMPTS_EXHAUSTED,
        'Too many attempts on this verification. Start again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.callProvider(() =>
      this.provider.verifyAadhaarOtp({
        providerReference: pending.providerReference as string,
        otp: input.otp,
      }),
    );

    const identity = result.outcome === 'VERIFIED' ? result.identity : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.kycVerification.update({
        where: { id: pending.id },
        data: {
          attempts: { increment: 1 },
          status: this.statusFor(result),
          failureCode: result.outcome === 'VERIFIED' ? null : result.failureCode,
          verifiedAt: identity ? new Date() : null,
          ...this.identityColumns(identity),
        },
      });
      await this.recordTrail(
        tx,
        userId,
        row.id,
        result.outcome === 'VERIFIED' ? 'KYC_VERIFIED' : 'KYC_FAILED',
        {
          provider: this.provider.name,
          method: KycMethod.AADHAAR_OFFLINE_XML,
          outcome: result.outcome,
          failureCode: result.outcome === 'VERIFIED' ? null : result.failureCode,
        },
      );
      return row;
    });

    if (result.outcome !== 'VERIFIED') {
      throw new AppException(
        ErrorCode.KYC_VERIFICATION_FAILED,
        'That verification code is not valid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { verificationId: updated.id, failureCode: result.failureCode },
      );
    }

    return {
      verificationId: updated.id,
      status: updated.status,
      method: KycMethod.AADHAAR_OFFLINE_XML,
      documentLast4: updated.documentLast4,
      name: identity?.name,
      dateOfBirth: identity?.dateOfBirth,
    };
  }

  /** A verified method is terminal; attempts on a method are capped. */
  private async assertMethodOpen(userId: string, method: KycMethod): Promise<void> {
    const existing = await this.prisma.kycVerification.findMany({ where: { userId, method } });
    if (existing.some((row) => row.status === KycStatus.VERIFIED)) {
      throw new AppException(
        ErrorCode.KYC_ALREADY_VERIFIED,
        'This document is already verified.',
        HttpStatus.CONFLICT,
      );
    }
    if (existing.length >= KycService.MAX_ATTEMPTS_PER_METHOD) {
      throw new AppException(
        ErrorCode.KYC_ATTEMPTS_EXHAUSTED,
        'Too many verification attempts. Contact support to continue.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * The same document verified under a different customer is an impersonation
   * signal, so it is refused here rather than quietly accepted.
   */
  private async assertDocumentUnused(userId: string, document: string): Promise<void> {
    const clash = await this.prisma.kycVerification.findFirst({
      where: {
        documentBlindIndex: this.crypto.blindIndex(document),
        status: KycStatus.VERIFIED,
        userId: { not: userId },
      },
    });
    if (!clash) return;

    await this.audit.record({
      actorType: 'SYSTEM',
      action: 'KYC_DOCUMENT_REUSE_DETECTED',
      resourceType: 'kyc_verification',
      resourceId: clash.id,
      newValue: { attemptedByUserId: userId },
    });
    throw new AppException(
      ErrorCode.KYC_DOCUMENT_ALREADY_USED,
      'This document is already linked to another account. Contact support.',
      HttpStatus.CONFLICT,
    );
  }

  private async persist(params: {
    userId: string;
    method: KycMethod;
    document: string;
    result: KycProviderResult;
    meta: { ip?: string };
  }) {
    const identity = params.result.outcome === 'VERIFIED' ? params.result.identity : undefined;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.kycVerification.create({
        data: {
          userId: params.userId,
          method: params.method,
          status: this.statusFor(params.result),
          providerName: this.provider.name,
          providerReference: params.result.providerReference,
          documentNumberEncrypted: this.crypto.encryptField(params.document),
          documentBlindIndex: this.crypto.blindIndex(params.document),
          documentLast4: params.document.slice(-4),
          failureCode: params.result.outcome === 'VERIFIED' ? null : params.result.failureCode,
          verifiedAt: identity ? new Date() : null,
          attempts: 1,
          ...this.identityColumns(identity),
        },
      });
      await this.recordTrail(
        tx,
        params.userId,
        row.id,
        params.result.outcome === 'VERIFIED' ? 'KYC_VERIFIED' : 'KYC_FAILED',
        {
          provider: this.provider.name,
          method: params.method,
          outcome: params.result.outcome,
          documentLast4: row.documentLast4,
          failureCode: params.result.outcome === 'VERIFIED' ? null : params.result.failureCode,
        },
      );
      return row;
    });
  }

  private identityColumns(identity?: VerifiedIdentity) {
    if (!identity) return {};
    return {
      nameEncrypted: this.crypto.encryptField(identity.name),
      dobEncrypted: identity.dateOfBirth ? this.crypto.encryptField(identity.dateOfBirth) : null,
      addressEncrypted: identity.address ? this.crypto.encryptField(identity.address) : null,
      nameMatchScore:
        identity.nameMatchScore === undefined
          ? null
          : new Prisma.Decimal(identity.nameMatchScore.toFixed(4)),
    };
  }

  private statusFor(result: KycProviderResult): KycStatus {
    if (result.outcome === 'VERIFIED') return KycStatus.VERIFIED;
    return result.outcome === 'MANUAL_REVIEW' ? KycStatus.MANUAL_REVIEW : KycStatus.FAILED;
  }

  private async recordTrail(
    tx: Prisma.TransactionClient,
    userId: string,
    verificationId: string,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorType: 'CUSTOMER',
        actorId: userId,
        action,
        resourceType: 'kyc_verification',
        resourceId: verificationId,
        newValue: detail,
      },
      tx,
    );
    await this.outbox.emit(
      {
        aggregateType: 'user',
        aggregateId: userId,
        eventType: action === 'KYC_VERIFIED' ? 'KycVerified' : 'KycAttempted',
        payload: { userId, verificationId, ...detail },
      },
      tx,
    );
  }

  /**
   * A provider outage must surface as an explicit, retryable failure. It must
   * never be interpreted as a verified — or as a rejected — identity.
   */
  private async callProvider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch {
      throw new AppException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'Verification is temporarily unavailable. Please try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
