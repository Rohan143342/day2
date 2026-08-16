import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requestContext } from './request-context';

export interface DomainEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox. Callers must pass the transaction client that performed
 * the state change: publishing directly to a broker from application code
 * reintroduces the dual-write problem this table exists to remove.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(event: DomainEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        eventVersion: event.eventVersion ?? 1,
        payload: event.payload as Prisma.InputJsonValue,
        correlationId: requestContext.correlationId(),
      },
    });
  }
}
