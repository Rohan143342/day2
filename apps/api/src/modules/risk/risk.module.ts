import { Module } from '@nestjs/common';
import { FraudService } from './fraud.service';
import { RiskService } from './risk.service';

@Module({
  providers: [FraudService, RiskService],
  exports: [FraudService, RiskService],
})
export class RiskModule {}
