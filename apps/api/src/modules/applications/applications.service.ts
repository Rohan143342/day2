import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  DecisionOutcome,
  IncomeVerificationMethod,
  LoanApplication,
  Prisma,
} from '@prisma/client';
import { Money } from '@lending/money';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { AppException, ErrorCode } from '../../common/errors';
import { OutboxService } from '../../common/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import { ProductsService } from '../products/products.service';
import { ACTIVE_CREDIT_POLICY, REASON_CODE_MESSAGES, ReasonCodeValue } from '../risk/policy';
import { RiskService } from '../risk/risk.service';
import { CreateApplicationDto, SubmitProfileDto } from './dto';
import { canTransition, isEditable, isTerminal } from './state-machine';

export interface ApplicationView {
  id: string;
  status: ApplicationStatus;
  statusReason: string | null;
  productVersionId: string;
  lender: { legalName: string; brandName: string; licenseType: string; licenseReference: string };
  requestedAmount: string;
  requestedTenureMonths: number;
  purposeCode: string;
  profileComplete: boolean;
  submittedAt: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  decision: DecisionView | null;
}

export interface DecisionView {
  outcome: DecisionOutcome;
  /** Reason codes plus the wording derived from them; the codes are canonical. */
  reasons: Array<{ code: string; message: string }>;
  eligibleAmount: string | null;
  eligibleTenureMonths: number | null;
  offeredRatePercent: string | null;
  decidedAt: string;
}

/**
 * Loan application lifecycle.
 *
 * Every status change goes through `transition()`, which refuses moves the state
 * machine does not allow, writes an append-only history row, and emits audit and
 * outbox records in the same transaction as the change itself. Nothing else in
 * the codebase may write `status` directly.
 */
@Injectable()
export class ApplicationsService {
  /** Statuses in which a customer already has a live request. */
  private static readonly ACTIVE_STATUSES: ApplicationStatus[] = [
    ApplicationStatus.DRAFT,
    ApplicationStatus.PROFILE_SUBMITTED,
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.REFERRED,
    ApplicationStatus.APPROVED,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly consent: ConsentService,
    private readonly products: ProductsService,
    private readonly risk: RiskService,
  ) {}

  async create(
    userId: string,
    deviceId: string | null,
    dto: CreateApplicationDto,
  ): Promise<ApplicationView> {
    await this.consent.assertGranted(userId, ['IDENTITY_VERIFICATION']);

    const version = await this.products.requireOfferableVersion(dto.productVersionId);
    this.products.assertWithinLimits(version, Money.fromMajor(dto.amount), dto.tenureMonths);

    // One live application per customer: parallel requests would produce
    // competing decisions and duplicate credit exposure for the same borrower.
    const existing = await this.prisma.loanApplication.findFirst({
      where: { userId, status: { in: ApplicationsService.ACTIVE_STATUSES } },
    });
    if (existing) {
      throw new AppException(
        ErrorCode.APPLICATION_ALREADY_IN_PROGRESS,
        'You already have an application in progress.',
        HttpStatus.CONFLICT,
        { applicationId: existing.id, status: existing.status },
      );
    }

    const application = await this.prisma.$transaction(async (tx) => {
      const created = await tx.loanApplication.create({
        data: {
          userId,
          productVersionId: version.id,
          deviceId,
          requestedAmount: new Prisma.Decimal(dto.amount),
          requestedTenureMonths: dto.tenureMonths,
          purposeCode: dto.purposeCode,
          status: ApplicationStatus.DRAFT,
        },
      });
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: created.id,
          fromStatus: null,
          toStatus: ApplicationStatus.DRAFT,
          actorType: 'CUSTOMER',
          actorId: userId,
          reason: 'Application created',
        },
      });
      await this.trail(tx, userId, created.id, 'APPLICATION_CREATED', 'ApplicationCreated', {
        productVersionId: version.id,
        requestedAmount: dto.amount,
        requestedTenureMonths: dto.tenureMonths,
        purposeCode: dto.purposeCode,
      });
      return created;
    });

    return this.view(application.id, userId);
  }

  async list(userId: string): Promise<ApplicationView[]> {
    const rows = await this.prisma.loanApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return Promise.all(rows.map((row) => this.view(row.id, userId)));
  }

  /**
   * Declared financial and employment position. Stored against this application
   * only, so a later edit cannot restate the basis of a decision already taken.
   */
  async submitProfile(
    userId: string,
    applicationId: string,
    dto: SubmitProfileDto,
  ): Promise<ApplicationView> {
    await this.consent.assertGranted(userId, ['IDENTITY_VERIFICATION', 'CREDIT_BUREAU_ENQUIRY']);
    const application = await this.require(userId, applicationId);
    if (!isEditable(application.status)) {
      throw new AppException(
        ErrorCode.APPLICATION_NOT_EDITABLE,
        'This application can no longer be edited.',
        HttpStatus.CONFLICT,
        { status: application.status },
      );
    }

    const ageYears = this.ageFromDateOfBirth(dto.dateOfBirth);
    const profileData = {
      userId,
      employmentType: dto.employmentType,
      employerNameEncrypted: dto.employerName ? this.crypto.encryptField(dto.employerName) : null,
      workExperienceMonths: dto.workExperienceMonths,
      monthlyIncome: new Prisma.Decimal(dto.monthlyIncome),
      existingMonthlyEmi: new Prisma.Decimal(dto.existingMonthlyEmi),
      // Client-supplied verification strength is ignored beyond DECLARED: only a
      // provider result may upgrade it.
      incomeVerification: IncomeVerificationMethod.DECLARED,
      residenceState: dto.residenceState.trim().toUpperCase(),
      residencePincode: dto.residencePincode,
      dateOfBirthEncrypted: this.crypto.encryptField(dto.dateOfBirth),
      ageYears,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.applicantProfile.upsert({
        where: { applicationId },
        create: { applicationId, ...profileData },
        update: profileData,
      });
      if (application.status === ApplicationStatus.DRAFT) {
        await this.transition(tx, application, ApplicationStatus.PROFILE_SUBMITTED, {
          reason: 'Financial and employment details provided',
          actorType: 'CUSTOMER',
          actorId: userId,
        });
      }
      await this.trail(tx, userId, applicationId, 'APPLICATION_PROFILE_SUBMITTED', 'ApplicationProfileSubmitted', {
        // Income figures are material to the decision and are retained; the
        // employer name and date of birth are not written to the trail.
        employmentType: dto.employmentType,
        workExperienceMonths: dto.workExperienceMonths,
        monthlyIncome: dto.monthlyIncome,
        existingMonthlyEmi: dto.existingMonthlyEmi,
        residenceState: profileData.residenceState,
        ageYears,
      });
    });

    return this.view(applicationId, userId);
  }

  /**
   * Runs decisioning. Idempotent at the HTTP layer, and guarded here by a
   * conditional status update so two concurrent submissions cannot both decide.
   */
  async submit(userId: string, applicationId: string): Promise<ApplicationView> {
    await this.consent.assertGranted(userId, ['IDENTITY_VERIFICATION', 'CREDIT_BUREAU_ENQUIRY']);
    const application = await this.require(userId, applicationId);
    const profile = await this.prisma.applicantProfile.findUnique({ where: { applicationId } });
    if (!profile) {
      throw new AppException(
        ErrorCode.APPLICATION_PROFILE_REQUIRED,
        'Provide your financial and employment details before submitting.',
        HttpStatus.CONFLICT,
      );
    }

    const claimed = await this.prisma.loanApplication.updateMany({
      where: { id: applicationId, status: ApplicationStatus.PROFILE_SUBMITTED },
      data: { status: ApplicationStatus.UNDER_REVIEW, submittedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppException(
        ErrorCode.APPLICATION_INVALID_TRANSITION,
        'This application is not awaiting submission.',
        HttpStatus.CONFLICT,
        { status: application.status },
      );
    }
    await this.prisma.applicationStatusHistory.create({
      data: {
        applicationId,
        fromStatus: ApplicationStatus.PROFILE_SUBMITTED,
        toStatus: ApplicationStatus.UNDER_REVIEW,
        actorType: 'CUSTOMER',
        actorId: userId,
        reason: 'Submitted for decisioning',
      },
    });

    const version = await this.products.requireOfferableVersion(application.productVersionId);
    const decision = await this.risk.decide({
      userId,
      applicationId,
      deviceId: application.deviceId,
      profile,
      version,
      requestedAmount: application.requestedAmount,
      requestedTenureMonths: application.requestedTenureMonths,
    });

    const nextStatus =
      decision.outcome === DecisionOutcome.APPROVE
        ? ApplicationStatus.APPROVED
        : decision.outcome === DecisionOutcome.REFER
          ? ApplicationStatus.REFERRED
          : ApplicationStatus.REJECTED;

    await this.prisma.$transaction(async (tx) => {
      await tx.riskDecision.create({
        data: {
          applicationId,
          policyVersion: decision.policyVersion,
          outcome: decision.outcome,
          reasonCodes: decision.reasonCodes,
          eligibleAmount: decision.eligibleAmount
            ? new Prisma.Decimal(decision.eligibleAmount.toMajorString())
            : null,
          eligibleTenureMonths: decision.eligibleTenureMonths,
          offeredRatePercent: decision.offeredRatePercent
            ? new Prisma.Decimal(decision.offeredRatePercent.toFixed(4))
            : null,
          foir: decision.foir ? new Prisma.Decimal(decision.foir.toFixed(4)) : null,
          fraudScore: decision.fraudScore,
          fraudSignals: decision.fraudSignals,
          inputs: decision.inputs,
        },
      });

      const expiresAt =
        nextStatus === ApplicationStatus.APPROVED
          ? new Date(Date.now() + ACTIVE_CREDIT_POLICY.approvalValidityHours * 60 * 60 * 1000)
          : null;
      await this.transition(
        tx,
        { ...application, status: ApplicationStatus.UNDER_REVIEW },
        nextStatus,
        {
          reason: decision.reasonCodes.join(','),
          actorType: 'SYSTEM',
          extraData: { decidedAt: new Date(), expiresAt },
        },
      );
      await this.trail(tx, userId, applicationId, 'APPLICATION_DECIDED', 'ApplicationDecided', {
        policyVersion: decision.policyVersion,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        fraudScore: decision.fraudScore,
        fraudSignals: decision.fraudSignals,
        eligibleAmount: decision.eligibleAmount?.toMajorString() ?? null,
      });
    });

    return this.view(applicationId, userId);
  }

  async withdraw(userId: string, applicationId: string, reason: string): Promise<ApplicationView> {
    const application = await this.require(userId, applicationId);
    if (isTerminal(application.status)) {
      throw new AppException(
        ErrorCode.APPLICATION_INVALID_TRANSITION,
        'This application is already closed.',
        HttpStatus.CONFLICT,
        { status: application.status },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, application, ApplicationStatus.WITHDRAWN, {
        reason,
        actorType: 'CUSTOMER',
        actorId: userId,
      });
      await this.trail(tx, userId, applicationId, 'APPLICATION_WITHDRAWN', 'ApplicationWithdrawn', {
        reason,
      });
    });
    return this.view(applicationId, userId);
  }

  async view(applicationId: string, userId: string): Promise<ApplicationView> {
    let application = await this.require(userId, applicationId);
    application = await this.applyExpiry(application);

    const [version, profile, decision] = await Promise.all([
      this.prisma.loanProductVersion.findUniqueOrThrow({
        where: { id: application.productVersionId },
        include: { product: { include: { lender: true } } },
      }),
      this.prisma.applicantProfile.findUnique({ where: { applicationId } }),
      this.prisma.riskDecision.findFirst({
        where: { applicationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      id: application.id,
      status: application.status,
      statusReason: application.statusReason,
      productVersionId: application.productVersionId,
      lender: {
        legalName: version.product.lender.legalName,
        brandName: version.product.lender.brandName,
        licenseType: version.product.lender.licenseType,
        licenseReference: version.product.lender.licenseReference,
      },
      requestedAmount: application.requestedAmount.toFixed(2),
      requestedTenureMonths: application.requestedTenureMonths,
      purposeCode: application.purposeCode,
      profileComplete: Boolean(profile),
      submittedAt: application.submittedAt?.toISOString() ?? null,
      decidedAt: application.decidedAt?.toISOString() ?? null,
      expiresAt: application.expiresAt?.toISOString() ?? null,
      createdAt: application.createdAt.toISOString(),
      decision: decision
        ? {
            outcome: decision.outcome,
            reasons: decision.reasonCodes.map((code) => ({
              code,
              message:
                REASON_CODE_MESSAGES[code as ReasonCodeValue] ??
                'Your application could not be approved.',
            })),
            eligibleAmount: decision.eligibleAmount?.toFixed(2) ?? null,
            eligibleTenureMonths: decision.eligibleTenureMonths,
            offeredRatePercent: decision.offeredRatePercent?.toFixed(4) ?? null,
            decidedAt: decision.createdAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * An approval that has passed its validity window is expired on read, so a
   * stale approval can never be acted on just because no batch job has run yet.
   */
  private async applyExpiry(application: LoanApplication): Promise<LoanApplication> {
    if (
      application.status !== ApplicationStatus.APPROVED ||
      !application.expiresAt ||
      application.expiresAt > new Date()
    ) {
      return application;
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.loanApplication.updateMany({
        where: { id: application.id, status: ApplicationStatus.APPROVED },
        data: { status: ApplicationStatus.EXPIRED, statusReason: 'Approval validity elapsed' },
      });
      if (claimed.count === 0) return application;
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: application.id,
          fromStatus: ApplicationStatus.APPROVED,
          toStatus: ApplicationStatus.EXPIRED,
          actorType: 'SYSTEM',
          reason: 'Approval validity elapsed',
        },
      });
      await this.trail(
        tx,
        application.userId,
        application.id,
        'APPLICATION_EXPIRED',
        'ApplicationExpired',
        { expiredAt: new Date().toISOString() },
      );
      return { ...application, status: ApplicationStatus.EXPIRED };
    });
  }

  private async require(userId: string, applicationId: string): Promise<LoanApplication> {
    const application = await this.prisma.loanApplication.findFirst({
      where: { id: applicationId, userId },
    });
    if (!application) {
      // Scoped by user, so another customer's application is indistinguishable
      // from one that does not exist.
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'That application was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return application;
  }

  /** The only writer of `status`. Refuses any move the lifecycle disallows. */
  private async transition(
    tx: Prisma.TransactionClient,
    application: LoanApplication,
    to: ApplicationStatus,
    options: {
      reason?: string;
      actorType: string;
      actorId?: string;
      extraData?: Prisma.LoanApplicationUpdateInput;
    },
  ): Promise<void> {
    if (!canTransition(application.status, to)) {
      throw new AppException(
        ErrorCode.APPLICATION_INVALID_TRANSITION,
        'That change is not allowed for this application.',
        HttpStatus.CONFLICT,
        { from: application.status, to },
      );
    }
    await tx.loanApplication.update({
      where: { id: application.id },
      data: { status: to, statusReason: options.reason ?? null, ...options.extraData },
    });
    await tx.applicationStatusHistory.create({
      data: {
        applicationId: application.id,
        fromStatus: application.status,
        toStatus: to,
        reason: options.reason,
        actorType: options.actorType,
        actorId: options.actorId,
      },
    });
  }

  private async trail(
    tx: Prisma.TransactionClient,
    userId: string,
    applicationId: string,
    action: string,
    eventType: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorType: 'CUSTOMER',
        actorId: userId,
        action,
        resourceType: 'loan_application',
        resourceId: applicationId,
        newValue: detail,
      },
      tx,
    );
    await this.outbox.emit(
      {
        aggregateType: 'loan_application',
        aggregateId: applicationId,
        eventType,
        payload: { userId, applicationId, ...detail },
      },
      tx,
    );
  }

  /** Whole years completed, evaluated on calendar dates rather than 365-day spans. */
  private ageFromDateOfBirth(dateOfBirth: string): number {
    const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime())) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'That date of birth is not valid.');
    }
    const now = new Date();
    if (dob > now) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'That date of birth is not valid.');
    }
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const beforeBirthday =
      now.getUTCMonth() < dob.getUTCMonth() ||
      (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
    if (beforeBirthday) age -= 1;
    return age;
  }
}
