import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { InitiateAadhaarDto, VerifyAadhaarOtpDto, VerifyPanDto } from './dto';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@ApiBearerAuth()
@Controller({ path: 'kyc', version: '1' })
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get('status')
  @ApiOperation({ summary: 'KYC state per method; document numbers are never returned' })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.status(user.userId);
  }

  @Post('pan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a PAN against the provider of record' })
  verifyPan(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyPanDto, @Ip() ip: string) {
    return this.kyc.verifyPan(user.userId, body, { ip });
  }

  @Post('aadhaar/otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request an offline-Aadhaar OTP',
    description:
      'The OTP is sent by the issuing authority to the number registered against the Aadhaar, not by this platform.',
  })
  initiateAadhaar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InitiateAadhaarDto,
    @Ip() ip: string,
  ) {
    return this.kyc.initiateAadhaar(user.userId, body.aadhaar, { ip });
  }

  @Post('aadhaar/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release offline-Aadhaar identity data using the OTP' })
  verifyAadhaar(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyAadhaarOtpDto) {
    return this.kyc.verifyAadhaarOtp(user.userId, body);
  }
}
