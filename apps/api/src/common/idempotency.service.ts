import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException, ErrorCode } from './errors';

export type IdempotencyOutcome =
  | { kind: 'PROCEED' }
  | { kind: 'REPLAY'; status: number; body: unknown };

const RETENTION_HOURS = 24;

/**
 * Idempotency enforced by the database, not by application logic: the primary
 * key on `idempotency_keys` is what makes a concurrent duplicate lose. Two
 * simultaneous identical requests therefore cannot both proceed, regardless of
 * how many API instances are running.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  static hashRequest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  }

  async begin(params: {
    key: string;
    endpoint: string;
    userId?: string;
    body: unknown;
  }): Promise<IdempotencyOutcome> {
    const requestHash = IdempotencyService.hashRequest(params.body);
    const expiresAt = new Date(Date.now() + RETENTION_HOURS * 3600 * 1000);

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: params.key,
          endpoint: params.endpoint,
          userId: params.userId,
          requestHash,
          status: 'IN_FLIGHT',
          expiresAt,
        },
      });
      return { kind: 'PROCEED' };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { key: params.key } });

    if (existing.endpoint !== params.endpoint || existing.requestHash !== requestHash) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This idempotency key was already used for a different request.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (existing.status === 'IN_FLIGHT') {
      throw new AppException(
        ErrorCode.IDEMPOTENT_REQUEST_IN_FLIGHT,
        'An identical request is still being processed. Retry shortly.',
        HttpStatus.CONFLICT,
      );
    }

    return { kind: 'REPLAY', status: existing.responseStatus ?? HttpStatus.OK, body: existing.responseBody };
  }

  async complete(key: string, status: number, body: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: {
        status: 'COMPLETED',
        responseStatus: status,
        responseBody: (body ?? null) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  /** A failed request releases its key so the caller can legitimately retry. */
  async release(key: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { key, status: 'IN_FLIGHT' } });
  }
}
