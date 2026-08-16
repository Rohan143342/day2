import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { ProductsModule } from '../products/products.module';
import { RiskModule } from '../risk/risk.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [ConsentModule, ProductsModule, RiskModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
