import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { ConsentService } from './consent.service';
import { RecordConsentsDto, WithdrawConsentDto } from './dto';

@ApiTags('consent')
@ApiBearerAuth()
@Controller({ path: 'consents', version: '1' })
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get()
  @ApiOperation({ summary: 'List consent purposes with current wording and the customer\u2019s current state' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('locale') locale?: string) {
    return this.consent.listPurposes(user.userId, locale ?? 'en-IN');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record explicit per-purpose consent decisions' })
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordConsentsDto,
    @Req() req: Request,
    @Query('locale') locale?: string,
  ) {
    return this.consent.record(user.userId, body.decisions, {
      ip: req.ip,
      deviceId: user.deviceId,
      locale: locale ?? 'en-IN',
    });
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a previously granted consent' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Body() body: WithdrawConsentDto) {
    return this.consent.withdraw(user.userId, body.purposeCode, body.reason);
  }
}
