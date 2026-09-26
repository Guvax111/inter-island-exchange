import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OnboardingDto, PasswordConfirmDto, UpdateMeDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { ProfilesService } from './profiles.service';

@ApiTags('me')
@Controller('me')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @RequirePermissions('profile.read.own')
  @Get()
  me(@CurrentPrincipal() principal: Principal) {
    return this.profiles.getMe(principal);
  }

  @RequirePermissions('profile.update.own')
  @Patch()
  @HttpCode(204)
  async update(@CurrentPrincipal() principal: Principal, @Body() body: UpdateMeDto, @Req() req: Request) {
    await this.profiles.updateMe(principal, body, requestMeta(req));
  }

  @RequirePermissions('profile.update.own')
  @Post('onboarding')
  @HttpCode(204)
  async onboarding(@CurrentPrincipal() principal: Principal, @Body() body: OnboardingDto, @Req() req: Request) {
    await this.profiles.submitOnboarding(principal, body, requestMeta(req));
  }

  @RequirePermissions('account.delete.own')
  @Post('deletion-request')
  @HttpCode(202)
  async requestDeletion(@CurrentPrincipal() principal: Principal, @Body() body: PasswordConfirmDto, @Req() req: Request) {
    await this.profiles.requestDeletion(principal, body.password, body.reason, requestMeta(req));
    return { message: 'Your deletion request has been received. Our team will contact you to complete it.' };
  }
}
