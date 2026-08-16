import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  correlationId: string;
  ipHash?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run: <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn),
  get: (): RequestContext | undefined => storage.getStore(),
  correlationId: (): string => storage.getStore()?.correlationId ?? 'no-correlation-id',
  setUserId: (userId: string): void => {
    const store = storage.getStore();
    if (store) store.userId = userId;
  },
};

/**
 * Every request carries a correlation ID end to end: response header, log lines,
 * audit rows, and outbox events. A client-supplied ID is accepted so mobile
 * crash reports can be joined to server traces, but it is length-capped.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const supplied = req.header('x-request-id');
    const correlationId = supplied && supplied.length <= 64 ? supplied : randomUUID();
    res.setHeader('x-request-id', correlationId);
    requestContext.run({ correlationId }, () => next());
  }
}
