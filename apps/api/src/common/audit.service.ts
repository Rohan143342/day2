import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { logSafe } from './masking';
import { requestContext } from './request-context';

export interface AuditEntry {
  actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM' | 'PROVIDER';
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

/**
 * Append-only audit trail. Writes accept an optional transaction client so an
 * audit row lands in the same transaction as the change it describes — an
 * unaudited state change should not be possible.
 *
 * Values are passed through the log masker so the audit trail records *that*
 * a phone number changed without storing a second plaintext copy of it.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const context = requestContext.get();
    await client.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? context?.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        oldValue: entry.oldValue === undefined ? undefined : (logSafe(entry.oldValue) as Prisma.InputJsonValue),
        newValue: entry.newValue === undefined ? undefined : (logSafe(entry.newValue) as Prisma.InputJsonValue),
        reason: entry.reason,
        ipHash: context?.ipHash,
        correlationId: requestContext.correlationId(),
      },
    });
  }
}
