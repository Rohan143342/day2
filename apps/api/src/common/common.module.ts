import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { IdempotencyService } from './idempotency.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [CryptoService, AuditService, OutboxService, IdempotencyService],
  exports: [CryptoService, AuditService, OutboxService, IdempotencyService],
})
export class CommonModule {}
