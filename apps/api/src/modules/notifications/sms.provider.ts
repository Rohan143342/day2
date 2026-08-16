import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskTail } from '../../common/masking';

export interface SmsMessage {
  to: string;
  templateCode: string;
  templateVersion: number;
  variables: Record<string, string>;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ providerReference: string }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * DEVELOPMENT MOCK. Selected only when SMS_PROVIDER=mock, which the config
 * schema rejects when NODE_ENV=production, so production cannot silently run
 * on a mock notification path.
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<{ providerReference: string }> {
    this.sent.push(message);
    this.logger.warn(
      `[MOCK SMS] template=${message.templateCode}@v${message.templateVersion} to=${maskTail(message.to)}`,
    );
    return { providerReference: `mock-${Date.now()}` };
  }
}

@Injectable()
export class SmsService {
  constructor(
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    private readonly config: ConfigService,
  ) {}

  async sendOtp(phone: string, code: string, minutesValid: number): Promise<void> {
    await this.provider.send({
      to: phone,
      templateCode: 'OTP_VERIFICATION',
      templateVersion: 1,
      // The OTP itself is a template variable, never written to a log line.
      variables: { code, minutes: String(minutesValid), brand: this.config.get('BRAND_NAME') ?? 'Lending' },
    });
  }
}
