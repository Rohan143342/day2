import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, from, switchMap, tap } from 'rxjs';
import { AppException, ErrorCode } from './errors';
import { IdempotencyService } from './idempotency.service';

export const IDEMPOTENT_KEY = 'idempotent';

/** Marks a route as requiring an `Idempotency-Key` header. */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler());
    if (!required) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { userId: string } }>();
    const response = http.getResponse<Response>();
    const key = request.header('idempotency-key');

    if (!key || key.length < 8 || key.length > 128) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'This endpoint requires an Idempotency-Key header between 8 and 128 characters.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;

    return from(
      this.idempotency.begin({ key, endpoint, userId: request.user?.userId, body: request.body }),
    ).pipe(
      switchMap((outcome) => {
        if (outcome.kind === 'REPLAY') {
          response.status(outcome.status);
          response.setHeader('idempotent-replay', 'true');
          return from([outcome.body]);
        }
        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.idempotency.complete(key, response.statusCode, body);
            },
            error: () => {
              void this.idempotency.release(key);
            },
          }),
        );
      }),
    );
  }
}
