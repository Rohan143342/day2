import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, documented error codes. Clients branch on `code`, never on message
 * text, and no internal detail (stack, SQL, provider payload) is ever exposed.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_ATTEMPTS_EXHAUSTED: 'OTP_ATTEMPTS_EXHAUSTED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  SESSION_REPLAY_DETECTED: 'SESSION_REPLAY_DETECTED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CONSENT_PURPOSE_UNKNOWN: 'CONSENT_PURPOSE_UNKNOWN',
  CONSENT_NOT_WITHDRAWABLE: 'CONSENT_NOT_WITHDRAWABLE',
  PRODUCT_NOT_AVAILABLE: 'PRODUCT_NOT_AVAILABLE',
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',
  TENURE_OUT_OF_RANGE: 'TENURE_OUT_OF_RANGE',
  KYC_ALREADY_VERIFIED: 'KYC_ALREADY_VERIFIED',
  KYC_ATTEMPTS_EXHAUSTED: 'KYC_ATTEMPTS_EXHAUSTED',
  KYC_VERIFICATION_FAILED: 'KYC_VERIFICATION_FAILED',
  KYC_DOCUMENT_ALREADY_USED: 'KYC_DOCUMENT_ALREADY_USED',
  KYC_CHALLENGE_NOT_FOUND: 'KYC_CHALLENGE_NOT_FOUND',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENT_REQUEST_IN_FLIGHT: 'IDEMPOTENT_REQUEST_IN_FLIGHT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCodeValue,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (resource: string): AppException =>
  new AppException(ErrorCode.NOT_FOUND, `${resource} was not found.`, HttpStatus.NOT_FOUND);
