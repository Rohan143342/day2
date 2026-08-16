import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AadhaarOtpRequest,
  AadhaarOtpVerificationRequest,
  KycProvider,
  KycProviderResult,
  PanVerificationRequest,
} from './kyc.provider';

/**
 * Development-only KYC provider. It is deterministic so that failure paths can
 * be tested, and it is refused at startup when NODE_ENV=production.
 *
 * It does NOT contact NSDL, UIDAI, DigiLocker or any bureau, and the identities
 * it returns are fabricated test data. Nothing it produces may be treated as a
 * completed KYC for a real customer.
 */
@Injectable()
export class MockKycProvider implements KycProvider {
  readonly name = 'mock';

  /** Aadhaar OTP challenges issued in this process, keyed by reference. */
  private readonly aadhaarChallenges = new Map<string, { otp: string; issuedAt: number }>();

  /** Fixed OTP so tests never have to read it out of the provider. */
  static readonly MOCK_AADHAAR_OTP = '123456';
  private static readonly OTP_TTL_MS = 10 * 60 * 1000;

  async verifyPan(request: PanVerificationRequest): Promise<KycProviderResult> {
    const providerReference = `mock-pan-${randomUUID()}`;
    // Deterministic test vectors keyed on the 4th character (PAN holder type).
    const holderType = request.pan.charAt(3).toUpperCase();
    if (request.pan.startsWith('ZZZZZ')) {
      return { outcome: 'FAILED', providerReference, failureCode: 'DOCUMENT_NOT_FOUND' };
    }
    if (holderType !== 'P') {
      // Only individual PANs (4th character 'P') can be a borrower here.
      return { outcome: 'FAILED', providerReference, failureCode: 'DOCUMENT_INACTIVE' };
    }
    const nameMatchScore = request.claimedName.trim().toUpperCase().startsWith('MISMATCH') ? 0.4 : 1;
    if (nameMatchScore < 0.7) {
      return { outcome: 'MANUAL_REVIEW', providerReference, failureCode: 'NAME_MISMATCH' };
    }
    return {
      outcome: 'VERIFIED',
      providerReference,
      identity: {
        name: request.claimedName.trim().toUpperCase(),
        dateOfBirth: request.dateOfBirth,
        nameMatchScore,
      },
    };
  }

  async initiateAadhaarOtp(request: AadhaarOtpRequest): Promise<{ providerReference: string }> {
    const providerReference = `mock-aadhaar-${randomUUID()}`;
    this.aadhaarChallenges.set(providerReference, {
      otp: MockKycProvider.MOCK_AADHAAR_OTP,
      issuedAt: Date.now(),
    });
    // The Aadhaar number itself is deliberately not retained here.
    void request;
    return { providerReference };
  }

  async verifyAadhaarOtp(request: AadhaarOtpVerificationRequest): Promise<KycProviderResult> {
    const challenge = this.aadhaarChallenges.get(request.providerReference);
    if (!challenge) {
      return {
        outcome: 'FAILED',
        providerReference: request.providerReference,
        failureCode: 'OTP_EXPIRED',
      };
    }
    if (Date.now() - challenge.issuedAt > MockKycProvider.OTP_TTL_MS) {
      this.aadhaarChallenges.delete(request.providerReference);
      return {
        outcome: 'FAILED',
        providerReference: request.providerReference,
        failureCode: 'OTP_EXPIRED',
      };
    }
    if (request.otp !== challenge.otp) {
      return {
        outcome: 'FAILED',
        providerReference: request.providerReference,
        failureCode: 'OTP_INVALID',
      };
    }
    this.aadhaarChallenges.delete(request.providerReference);
    return {
      outcome: 'VERIFIED',
      providerReference: request.providerReference,
      identity: {
        name: 'TEST AADHAAR HOLDER',
        dateOfBirth: '1990-01-01',
        address: 'Test address, Bengaluru, KA 560001',
        nameMatchScore: 1,
      },
    };
  }
}
