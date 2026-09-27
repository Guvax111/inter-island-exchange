import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SupportMessageDto, SupportThreadDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { SupportService } from './support.service';

/** A signed-in user's conversations with IIE. */
@ApiTags('support')
@Controller('me/messages')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @RequirePermissions('profile.read.own')
  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.support.listOwn(p);
  }

  @RequirePermissions('profile.read.own')
  @Post()
  start(@CurrentPrincipal() p: Principal, @Body() body: SupportThreadDto, @Req() req: Request) {
    return this.support.start(p, body, requestMeta(req));
  }

  @RequirePermissions('profile.read.own')
  @Get(':id')
  view(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.viewOwn(p, id);
  }

  @RequirePermissions('profile.read.own')
  @Post(':id/messages')
  @HttpCode(200)
  reply(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupportMessageDto, @Req() req: Request) {
    return this.support.replyOwn(p, id, body.body, requestMeta(req));
  }
}

/** IIE's support inbox. */
@ApiTags('admin')
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @RequirePermissions('support.respond')
  @Get()
  inbox(@CurrentPrincipal() p: Principal, @Query('status') status?: string, @Query('waiting') waiting?: string) {
    return this.support.inbox(p, { status: status === 'OPEN' || status === 'CLOSED' ? status : undefined, waiting: waiting === 'true' });
  }

  @RequirePermissions('support.respond')
  @Get(':id')
  view(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.viewAsStaff(p, id);
  }

  @RequirePermissions('support.respond')
  @Post(':id/messages')
  @HttpCode(200)
  reply(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupportMessageDto, @Req() req: Request) {
    return this.support.replyAsStaff(p, id, body.body, requestMeta(req));
  }

  @RequirePermissions('support.respond')
  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.support.setStatus(p, id, 'CLOSED', requestMeta(req));
  }

  @RequirePermissions('support.respond')
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.support.setStatus(p, id, 'OPEN', requestMeta(req));
  }
}
