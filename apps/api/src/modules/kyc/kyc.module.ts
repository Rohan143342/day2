import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsentModule } from '../consent/consent.module';
import { KycController } from './kyc.controller';
import { KYC_PROVIDER, KycProvider } from './kyc.provider';
import { KycService } from './kyc.service';
import { MockKycProvider } from './mock-kyc.provider';

@Module({
  imports: [ConsentModule],
  controllers: [KycController],
  providers: [
    MockKycProvider,
    {
      provide: KYC_PROVIDER,
      inject: [ConfigService, MockKycProvider],
      useFactory: (config: ConfigService, mock: MockKycProvider): KycProvider => {
        const provider = config.get<string>('KYC_PROVIDER') ?? 'mock';
        switch (provider) {
          case 'mock':
            return mock;
          default:
            // A real adapter is added here once a KYC vendor is contracted. An
            // unknown value must fail startup rather than fall back to the mock,
            // and env validation already refuses "mock" in production.
            throw new Error(`unsupported KYC provider "${provider}"`);
        }
      },
    },
    KycService,
  ],
  exports: [KycService, MockKycProvider],
})
export class KycModule {}
