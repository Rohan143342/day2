import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { RefreshDto, SendOtpDto, VerifyOtpDto } from './dto';
import { AuthenticatedUser, Public } from './jwt-auth.guard';

const meta = (req: Request): { ip?: string; userAgent?: string } => ({
  ip: req.ip,
  userAgent: req.header('user-agent'),
});

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a one-time verification code to an Indian mobile number' })
  sendOtp(@Body() body: SendOtpDto, @Req() req: Request) {
    return this.auth.sendOtp(body.phone, body.purpose, req.ip);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a code and issue an access/refresh token pair' })
  verifyOtp(@Body() body: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifyOtp(body.phone, body.code, body.device, meta(req));
  }

  @Public()
  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body() body: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logout(user.sessionId, user.userId);
  }

  @ApiBearerAuth()
  @Get('devices')
  listDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listDevices(user.userId);
  }

  @ApiBearerAuth()
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    await this.auth.revokeDevice(user.userId, deviceId);
  }
}
