import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { AppException, ErrorCode } from '../../common/errors';
import { OutboxService } from '../../common/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface ConsentPurposeView {
  code: string;
  title: string;
  description: string;
  dataCategories: string[];
  required: boolean;
  textVersion: number;
  locale: string;
  body: string;
  currentState: 'GRANTED' | 'WITHDRAWN' | 'DECLINED' | 'NOT_ANSWERED';
  answeredTextVersion: number | null;
}

export interface ConsentDecisionInput {
  purposeCode: string;
  textVersion: number;
  granted: boolean;
}

/**
 * Consent is recorded per purpose, per text version, with a timestamp and an
 * independent withdrawal record. Consent rows are never updated in place: the
 * history of what a customer agreed to, and which wording they saw, has to
 * remain reconstructible for an audit years later.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private hashIp(ip?: string): string | undefined {
    return ip ? createHash('sha256').update(ip).digest('hex') : undefined;
  }

  async listPurposes(userId: string, locale = 'en-IN'): Promise<ConsentPurposeView[]> {
    const now = new Date();
    const purposes = await this.prisma.consentPurpose.findMany({
      orderBy: [{ required: 'desc' }, { code: 'asc' }],
      include: {
        texts: {
          where: { locale, effectiveFrom: { lte: now } },
          orderBy: { version: 'desc' },
          take: 1,
        },
        consents: {
          where: { userId },
          orderBy: { grantedAt: 'desc' },
          take: 1,
        },
      },
    });

    return purposes.flatMap((purpose) => {
      const text = purpose.texts[0];
      // A purpose with no effective text in this locale is not presentable:
      // consent cannot be collected against wording the customer cannot read.
      if (!text) return [];
      const latest = purpose.consents[0];
      const currentState: ConsentPurposeView['currentState'] = !latest
        ? 'NOT_ANSWERED'
        : latest.withdrawnAt
          ? 'WITHDRAWN'
          : latest.granted
            ? 'GRANTED'
            : 'DECLINED';

      return [
        {
          code: purpose.code,
          title: purpose.title,
          description: purpose.description,
          dataCategories: purpose.dataCategories,
          required: purpose.required,
          textVersion: text.version,
          locale: text.locale,
          body: text.body,
          currentState,
          answeredTextVersion: latest?.textVersion ?? null,
        },
      ];
    });
  }

  async record(
    userId: string,
    decisions: ConsentDecisionInput[],
    meta: { ip?: string; deviceId?: string; locale?: string },
  ): Promise<{ recorded: number }> {
    const codes = decisions.map((d) => d.purposeCode);
    if (new Set(codes).size !== codes.length) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Each consent purpose may only appear once.');
    }

    const texts = await this.prisma.consentText.findMany({
      where: {
        locale: meta.locale ?? 'en-IN',
        OR: decisions.map((d) => ({ purposeCode: d.purposeCode, version: d.textVersion })),
      },
    });

    // The client must echo the exact text version it displayed. A mismatch means
    // the customer agreed to wording other than the one on record.
    for (const decision of decisions) {
      const match = texts.find(
        (t) => t.purposeCode === decision.purposeCode && t.version === decision.textVersion,
      );
      if (!match) {
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          `Unknown consent text ${decision.purposeCode} v${decision.textVersion}. Reload the consent screen.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const grantedAt = new Date();
    const ipHash = this.hashIp(meta.ip);

    await this.prisma.$transaction(async (tx) => {
      for (const decision of decisions) {
        await tx.consent.create({
          data: {
            userId,
            purposeCode: decision.purposeCode,
            textVersion: decision.textVersion,
            granted: decision.granted,
            grantedAt,
            ipHash,
            deviceId: meta.deviceId,
          },
        });
      }

      await this.audit.record(
        {
          actorType: 'CUSTOMER',
          actorId: userId,
          action: 'CONSENT_RECORDED',
          resourceType: 'consent',
          resourceId: userId,
          newValue: { decisions },
        },
        tx,
      );
      await this.outbox.emit(
        {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'ConsentRecorded',
          payload: { userId, decisions },
        },
        tx,
      );
    });

    return { recorded: decisions.length };
  }

  async withdraw(
    userId: string,
    purposeCode: string,
    reason: string,
  ): Promise<{ withdrawnAt: Date }> {
    const purpose = await this.prisma.consentPurpose.findUnique({ where: { code: purposeCode } });
    if (!purpose) throw new AppException(ErrorCode.NOT_FOUND, 'Unknown consent purpose.', HttpStatus.NOT_FOUND);

    const active = await this.prisma.consent.findFirst({
      where: { userId, purposeCode, granted: true, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    if (!active) {
      throw new AppException(ErrorCode.NOT_FOUND, 'There is no active consent to withdraw.', HttpStatus.NOT_FOUND);
    }

    const withdrawnAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.consent.update({ where: { id: active.id }, data: { withdrawnAt } });
      await this.audit.record(
        {
          actorType: 'CUSTOMER',
          actorId: userId,
          action: 'CONSENT_WITHDRAWN',
          resourceType: 'consent',
          resourceId: active.id,
          reason,
          oldValue: { granted: true },
          newValue: { granted: false, withdrawnAt },
        },
        tx,
      );
      await this.outbox.emit(
        {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'ConsentWithdrawn',
          // Downstream processing must stop for this purpose; withdrawal does not
          // erase obligations already created under a live loan agreement.
          payload: { userId, purposeCode, required: purpose.required, withdrawnAt: withdrawnAt.toISOString() },
        },
        tx,
      );
    });

    return { withdrawnAt };
  }

  /** Guard used by later journey steps: a required purpose must be actively granted. */
  async assertGranted(userId: string, purposeCodes: string[]): Promise<void> {
    for (const purposeCode of purposeCodes) {
      const granted = await this.prisma.consent.findFirst({
        where: { userId, purposeCode, granted: true, withdrawnAt: null },
      });
      if (!granted) {
        throw new AppException(
          ErrorCode.CONSENT_REQUIRED,
          `Consent for ${purposeCode} is required before continuing.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }
}
