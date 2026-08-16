import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSmsProvider, SMS_PROVIDER, SmsProvider, SmsService } from './sms.provider';

@Module({
  providers: [
    MockSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, MockSmsProvider],
      useFactory: (config: ConfigService, mock: MockSmsProvider): SmsProvider => {
        const provider = config.get<string>('SMS_PROVIDER') ?? 'mock';
        switch (provider) {
          case 'mock':
            return mock;
          default:
            // Real adapters are added here in Phase 2; an unknown value must fail
            // startup rather than fall back to the mock.
            throw new Error(`unsupported SMS provider "${provider}"`);
        }
      },
    },
    SmsService,
  ],
  exports: [SmsService, MockSmsProvider],
})
export class NotificationsModule {}
