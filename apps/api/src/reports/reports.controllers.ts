import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReportRecipientDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { ReportsService } from './reports.service';

/** The directors' weekly report: preview, history, recipients, and sending on demand. */
@ApiTags('admin')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** `weekOf`: any date (YYYY-MM-DD) in the week wanted; default the week that just ended. */
  @RequirePermissions('report.read')
  @Get('weekly')
  preview(@Query('weekOf') weekOf?: string) {
    return this.reports.preview(weekOf);
  }

  @RequirePermissions('report.read')
  @Get('runs')
  runs() {
    return this.reports.runs();
  }

  @RequirePermissions('report.read')
  @Post('weekly/send')
  @HttpCode(200)
  send(@CurrentPrincipal() p: Principal, @Query('weekOf') weekOf: string | undefined, @Req() req: Request) {
    return this.reports.sendNow(p, weekOf, requestMeta(req));
  }

  @RequirePermissions('report.read')
  @Get('recipients')
  recipients() {
    return this.reports.recipients();
  }

  @RequirePermissions('config.manage')
  @Post('recipients')
  add(@Body() body: ReportRecipientDto, @Req() req: Request) {
    return this.reports.addRecipient(body, requestMeta(req));
  }

  @RequirePermissions('config.manage')
  @Post('recipients/:id/:state')
  @HttpCode(204)
  async toggle(@Param('id', ParseUUIDPipe) id: string, @Param('state') state: string, @Req() req: Request) {
    await this.reports.setRecipientActive(id, state === 'enable', requestMeta(req));
  }
}
