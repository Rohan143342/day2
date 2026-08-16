import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose, Prisma, User, UserStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { AppException, ErrorCode } from '../../common/errors';
import { OutboxService } from '../../common/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../notifications/sms.provider';
import { DeviceInfoDto } from './dto';

export interface TokenPair {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_MINUTES = 15;
const OTP_MIN_INTERVAL_SECONDS = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private hashIp(ip?: string): string | undefined {
    return ip ? createHash('sha256').update(ip).digest('hex') : undefined;
  }

  async sendOtp(phone: string, purpose: 'REGISTRATION' | 'LOGIN', ip?: string): Promise<{ expiresInSeconds: number }> {
    const blindIndex = this.crypto.blindIndex(phone);
    let user = await this.prisma.user.findUnique({ where: { phoneBlindIndex: blindIndex } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phoneEncrypted: this.crypto.encryptField(phone),
          phoneBlindIndex: blindIndex,
          phoneLast4: phone.slice(-4),
        },
      });
      await this.audit.record({
        actorType: 'CUSTOMER',
        actorId: user.id,
        action: 'USER_CREATED',
        resourceType: 'user',
        resourceId: user.id,
      });
    }

    await this.enforceOtpRateLimits(user.id);

    const code = this.crypto.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    await this.prisma.otpChallenge.create({
      data: {
        userId: user.id,
        purpose: purpose === 'REGISTRATION' ? OtpPurpose.REGISTRATION : OtpPurpose.LOGIN,
        codeHash: this.crypto.hashOtp(code, user.id),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt,
      },
    });

    await this.sms.sendOtp(phone, code, OTP_TTL_MINUTES);
    await this.audit.record({
      actorType: 'CUSTOMER',
      actorId: user.id,
      action: 'OTP_SENT',
      resourceType: 'user',
      resourceId: user.id,
      // Hashed, never raw: enough to correlate abuse from one source without
      // keeping a plaintext address against a customer record.
      newValue: { purpose, ipHash: this.hashIp(ip) },
    });

    // The response is identical whether or not the number was already registered:
    // an unauthenticated caller must not be able to enumerate customers.
    return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  private async enforceOtpRateLimits(userId: string): Promise<void> {
    const windowStart = new Date(Date.now() - OTP_WINDOW_MINUTES * 60_000);
    const [recentCount, latest] = await Promise.all([
      this.prisma.otpChallenge.count({ where: { userId, createdAt: { gte: windowStart } } }),
      this.prisma.otpChallenge.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);

    if (recentCount >= OTP_MAX_PER_WINDOW) {
      throw new AppException(
        ErrorCode.OTP_RATE_LIMITED,
        'Too many verification codes requested. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (latest && Date.now() - latest.createdAt.getTime() < OTP_MIN_INTERVAL_SECONDS * 1000) {
      throw new AppException(
        ErrorCode.OTP_RATE_LIMITED,
        `Please wait ${OTP_MIN_INTERVAL_SECONDS} seconds before requesting another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async verifyOtp(
    phone: string,
    code: string,
    device: DeviceInfoDto,
    meta: { ip?: string; userAgent?: string },
  ): Promise<TokenPair & { userId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { phoneBlindIndex: this.crypto.blindIndex(phone) },
    });
    // Same error for "no such number" and "wrong code": no enumeration oracle.
    if (!user) throw this.invalidOtp();

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw this.invalidOtp();

    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new AppException(ErrorCode.OTP_EXPIRED, 'This verification code has expired. Request a new one.');
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new AppException(
        ErrorCode.OTP_ATTEMPTS_EXHAUSTED,
        'Too many incorrect attempts. Request a new verification code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!this.crypto.verifyOtp(code, user.id, challenge.codeHash)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      await this.audit.record({
        actorType: 'CUSTOMER',
        actorId: user.id,
        action: 'OTP_VERIFICATION_FAILED',
        resourceType: 'otp_challenge',
        resourceId: challenge.id,
      });
      throw this.invalidOtp();
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

      const activatedUser: User =
        user.status === UserStatus.PENDING_VERIFICATION
          ? await tx.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } })
          : user;

      const deviceRecord = await tx.device.upsert({
        where: { userId_installationId: { userId: user.id, installationId: device.installationId } },
        create: {
          userId: user.id,
          installationId: device.installationId,
          model: device.model,
          osVersion: device.osVersion,
          appVersion: device.appVersion,
          integrityVerdict: device.integrityVerdict,
        },
        update: {
          lastSeenAt: new Date(),
          model: device.model,
          osVersion: device.osVersion,
          appVersion: device.appVersion,
          integrityVerdict: device.integrityVerdict,
        },
      });

      const tokens = await this.issueSession(tx, {
        userId: user.id,
        deviceId: deviceRecord.id,
        familyId: randomUUID(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      await this.audit.record(
        {
          actorType: 'CUSTOMER',
          actorId: user.id,
          action: 'LOGIN_SUCCEEDED',
          resourceType: 'user',
          resourceId: user.id,
          newValue: { deviceId: deviceRecord.id, status: activatedUser.status },
        },
        tx,
      );
      await this.outbox.emit(
        {
          aggregateType: 'user',
          aggregateId: user.id,
          eventType: user.status === UserStatus.PENDING_VERIFICATION ? 'UserVerified' : 'UserLoggedIn',
          payload: { userId: user.id, deviceId: deviceRecord.id },
        },
        tx,
      );

      return { ...tokens, userId: user.id };
    });
  }

  private invalidOtp(): AppException {
    return new AppException(
      ErrorCode.OTP_INVALID,
      'That verification code is not valid.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private async issueSession(
    tx: Prisma.TransactionClient,
    params: { userId: string; deviceId: string; familyId: string; rotatedFromId?: string; ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const refreshToken = this.crypto.randomToken();
    const refreshTtlDays = Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    const accessTtlSeconds = Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS') ?? 600);
    const refreshExpiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);

    const session = await tx.session.create({
      data: {
        userId: params.userId,
        deviceId: params.deviceId,
        familyId: params.familyId,
        refreshTokenHash: this.crypto.hashToken(refreshToken),
        rotatedFromId: params.rotatedFromId,
        expiresAt: refreshExpiresAt,
        ipHash: this.hashIp(params.ip),
        userAgent: params.userAgent?.slice(0, 256),
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: params.userId, sid: session.id, did: params.deviceId },
      { expiresIn: accessTtlSeconds },
    );

    return { accessToken, expiresInSeconds: accessTtlSeconds, refreshToken, refreshExpiresAt };
  }

  /**
   * Refresh-token rotation with reuse detection. A refresh token is valid once.
   * Presenting a token that has already been rotated means the token leaked, so
   * the entire family is revoked rather than just the replayed session.
   */
  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const hash = this.crypto.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });

    if (!session) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Please sign in again.', HttpStatus.UNAUTHORIZED);
    }

    if (session.usedAt || session.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REFRESH_TOKEN_REPLAY' },
      });
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'SESSION_FAMILY_REVOKED',
        resourceType: 'session',
        resourceId: session.id,
        reason: 'refresh token replay detected',
      });
      this.logger.warn(`refresh token replay on family ${session.familyId}`);
      throw new AppException(
        ErrorCode.SESSION_REPLAY_DETECTED,
        'Your session was ended for security reasons. Please sign in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Please sign in again.', HttpStatus.UNAUTHORIZED);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { usedAt: new Date() } });
      return this.issueSession(tx, {
        userId: session.userId,
        deviceId: session.deviceId,
        familyId: session.familyId,
        rotatedFromId: session.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
    });
    await this.audit.record({
      actorType: 'CUSTOMER',
      actorId: userId,
      action: 'LOGOUT',
      resourceType: 'session',
      resourceId: sessionId,
    });
  }

  async listDevices(userId: string) {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      include: { sessions: { where: { revokedAt: null, usedAt: null }, select: { id: true, issuedAt: true } } },
    });
    return devices.map((device) => ({
      id: device.id,
      model: device.model,
      osVersion: device.osVersion,
      trustState: device.trustState,
      firstSeenAt: device.firstSeenAt,
      lastSeenAt: device.lastSeenAt,
      activeSessions: device.sessions.length,
    }));
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'DEVICE_REVOKED_BY_USER' },
    });
    await this.prisma.device.updateMany({ where: { id: deviceId, userId }, data: { trustState: 'BLOCKED' } });
    await this.audit.record({
      actorType: 'CUSTOMER',
      actorId: userId,
      action: 'DEVICE_REVOKED',
      resourceType: 'device',
      resourceId: deviceId,
    });
  }
}
