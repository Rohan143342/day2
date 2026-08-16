import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '../../common/idempotency.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto, SubmitProfileDto, WithdrawApplicationDto } from './dto';

@ApiTags('applications')
@ApiBearerAuth()
@Controller({ path: 'applications', version: '1' })
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Idempotent()
  @ApiOperation({ summary: 'Start a loan application against an offerable product version' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateApplicationDto) {
    return this.applications.create(user.userId, user.deviceId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List the caller\u2019s applications' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.applications.list(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Application state, including the latest decision and its reasons' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.view(id, user.userId);
  }

  @Put(':id/profile')
  @ApiOperation({ summary: 'Declare financial and employment details for this application' })
  submitProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitProfileDto,
  ) {
    return this.applications.submitProfile(user.userId, id, body);
  }

  @Post(':id/submit')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit for decisioning',
    description:
      'Runs the versioned credit policy and fraud checks. Requires an Idempotency-Key so a retried submission cannot produce a second decision.',
  })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.submit(user.userId, id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw an application that is not yet closed' })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WithdrawApplicationDto,
  ) {
    return this.applications.withdraw(user.userId, id, body.reason);
  }
}
