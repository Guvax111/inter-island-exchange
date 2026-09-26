import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ChangePasswordDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto, TotpCodeDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { AuthService } from './auth.service';
import { CurrentPrincipal } from './current-principal.decorator';
import { AuthRateLimit, Public, RequirePermissions } from './decorators';
import { SessionService } from './session.service';

const ACCEPTED = { message: 'If the details are valid, we have sent an email with next steps.' };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @AuthRateLimit()
  @Post('register')
  @HttpCode(202)
  async register(@Body() body: RegisterDto, @Req() req: Request) {
    await this.auth.register(body, requestMeta(req));
    return ACCEPTED;
  }

  @Public()
  @AuthRateLimit()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: TokenDto, @Req() req: Request) {
    await this.auth.verifyEmail(body.token, requestMeta(req));
    return { verified: true };
  }

  @AuthRateLimit()
  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(@CurrentPrincipal() principal: Principal) {
    await this.auth.resendVerification(principal);
    return ACCEPTED;
  }

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(principal, req, res);
  }

  @Public()
  @AuthRateLimit()
  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(@Body() body: EmailDto, @Req() req: Request) {
    await this.auth.forgotPassword(body.email, requestMeta(req));
    return ACCEPTED;
  }

  @Public()
  @AuthRateLimit()
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() body: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(body.token, body.password, requestMeta(req));
    return { reset: true };
  }

  @AuthRateLimit()
  @RequirePermissions('session.manage.own')
  @Post('password/change')
  @HttpCode(204)
  async changePassword(@CurrentPrincipal() principal: Principal, @Body() body: ChangePasswordDto, @Req() req: Request) {
    await this.auth.changePassword(principal, body.currentPassword, body.newPassword, requestMeta(req));
  }

  @RequirePermissions('session.manage.own')
  @Get('sessions')
  async listSessions(@CurrentPrincipal() principal: Principal) {
    const items = await this.sessions.listForUser(principal.userId);
    return { items: items.map((s) => ({ ...s, current: s.id === principal.sessionId })) };
  }

  @RequirePermissions('session.manage.own')
  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.auth.revokeSession(principal, id, requestMeta(req));
  }

  @RequirePermissions('session.manage.own')
  @Post('mfa/totp/setup')
  startTotp(@CurrentPrincipal() principal: Principal) {
    return this.auth.startTotpSetup(principal);
  }

  @AuthRateLimit()
  @RequirePermissions('session.manage.own')
  @Post('mfa/totp/confirm')
  @HttpCode(204)
  async confirmTotp(@CurrentPrincipal() principal: Principal, @Body() body: TotpCodeDto, @Req() req: Request) {
    await this.auth.confirmTotp(principal, body.code, requestMeta(req));
  }

  @AuthRateLimit()
  @RequirePermissions('session.manage.own')
  @Post('mfa/totp/disable')
  @HttpCode(204)
  async disableTotp(@CurrentPrincipal() principal: Principal, @Body() body: TotpCodeDto, @Req() req: Request) {
    await this.auth.disableTotp(principal, body.code, requestMeta(req));
  }
}
