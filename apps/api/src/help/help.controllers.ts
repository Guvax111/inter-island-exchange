import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { HELP_AUDIENCES } from '@iie/shared';
import { HelpArticleDto, HelpArticleUpdateDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { Public, RequirePermissions } from '../auth/decorators';
import { HelpService } from './help.service';

@ApiTags('help')
@Controller('help')
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Public()
  @Get()
  list(@Query('audience') audience?: string, @Query('q') q?: string) {
    const a = HELP_AUDIENCES.find((x) => x === audience);
    return this.help.listPublished({ audience: a, q: q?.trim().slice(0, 100) || undefined });
  }

  @Public()
  @Get(':slug')
  article(@Param('slug') slug: string) {
    return this.help.published(slug);
  }
}

@ApiTags('admin')
@Controller('admin/help')
export class AdminHelpController {
  constructor(private readonly help: HelpService) {}

  @RequirePermissions('content.manage')
  @Get()
  list() {
    return this.help.listAll();
  }

  @RequirePermissions('content.manage')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.help.get(id);
  }

  @RequirePermissions('content.manage')
  @Post()
  create(@CurrentPrincipal() p: Principal, @Body() body: HelpArticleDto, @Req() req: Request) {
    return this.help.create(p, body, requestMeta(req));
  }

  @RequirePermissions('content.manage')
  @Patch(':id')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: HelpArticleUpdateDto, @Req() req: Request) {
    return this.help.update(p, id, body, requestMeta(req));
  }

  @RequirePermissions('content.manage')
  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.help.setStatus(p, id, 'PUBLISHED', requestMeta(req));
  }

  @RequirePermissions('content.manage')
  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.help.setStatus(p, id, 'DRAFT', requestMeta(req));
  }
}
