/**
 * KYC provider contract.
 *
 * Every implementation is a thin adapter over a regulated data source. The
 * platform never decides identity itself: it records what the source returned,
 * with the provider name and reference, so any verdict can be reproduced during
 * an audit. No implementation may fabricate a verified identity.
 */
export type KycFailureCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'NAME_MISMATCH'
  | 'DOCUMENT_INACTIVE'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'PROVIDER_UNAVAILABLE';

export interface VerifiedIdentity {
  /** Name exactly as held by the source, not as typed by the applicant. */
  name: string;
  /** ISO date (YYYY-MM-DD) when the source supplies it. */
  dateOfBirth?: string;
  address?: string;
  /** Name-match confidence in [0,1] when the provider scores it. */
  nameMatchScore?: number;
}

export type KycProviderResult =
  | { outcome: 'VERIFIED'; providerReference: string; identity: VerifiedIdentity }
  | { outcome: 'FAILED'; providerReference: string; failureCode: KycFailureCode }
  | { outcome: 'MANUAL_REVIEW'; providerReference: string; failureCode: KycFailureCode };

export interface PanVerificationRequest {
  pan: string;
  /** Name the applicant claims, compared against the source by the provider. */
  claimedName: string;
  dateOfBirth: string;
}

export interface AadhaarOtpRequest {
  aadhaar: string;
}

export interface AadhaarOtpVerificationRequest {
  providerReference: string;
  otp: string;
}

export interface KycProvider {
  readonly name: string;
  verifyPan(request: PanVerificationRequest): Promise<KycProviderResult>;
  /**
   * Offline Aadhaar (UIDAI-issued XML/DigiLocker) flow: the OTP goes to the
   * number registered with UIDAI, and only the OTP holder can release the data.
   */
  initiateAadhaarOtp(request: AadhaarOtpRequest): Promise<{ providerReference: string }>;
  verifyAadhaarOtp(request: AadhaarOtpVerificationRequest): Promise<KycProviderResult>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
