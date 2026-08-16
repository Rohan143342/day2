import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppException, ErrorCode } from './errors';
import { requestContext } from './request-context';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = requestContext.correlationId();

    if (exception instanceof AppException) {
      const body: ErrorBody = {
        error: { code: exception.code, message: exception.message, requestId, details: exception.details },
      };
      response.status(exception.getStatus()).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : exception.message;
      const code =
        status === HttpStatus.BAD_REQUEST
          ? ErrorCode.VALIDATION_FAILED
          : status === HttpStatus.UNAUTHORIZED
            ? ErrorCode.UNAUTHENTICATED
            : status === HttpStatus.FORBIDDEN
              ? ErrorCode.FORBIDDEN
              : status === HttpStatus.NOT_FOUND
                ? ErrorCode.NOT_FOUND
                : ErrorCode.INTERNAL_ERROR;
      response.status(status).json({ error: { code, message, requestId } } satisfies ErrorBody);
      return;
    }

    // Unexpected: log server-side with the correlation ID, return nothing useful to a caller.
    this.logger.error(
      JSON.stringify({ requestId, message: exception instanceof Error ? exception.message : 'unknown error' }),
      exception instanceof Error ? exception.stack : undefined,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong on our side. Please try again.',
        requestId,
      },
    } satisfies ErrorBody);
  }
}
