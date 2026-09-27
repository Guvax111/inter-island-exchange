import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SettlementPaidDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { SettlementsService } from './settlements.service';

/** What the payment provider owes IIE and what IIE owes logistics partners, and recording those payments. */
@ApiTags('admin')
@Controller('admin/settlements')
export class AdminSettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @RequirePermissions('payout.approve')
  @Get()
  list(@CurrentPrincipal() p: Principal, @Query('status') status?: string, @Query('kind') kind?: string, @Query('overdue') overdue?: string) {
    return this.settlements.list(p, {
      status: status === 'DUE' || status === 'PAID' ? status : undefined,
      kind: kind === 'PROVIDER_REMITTANCE' || kind === 'LOGISTICS_PAYMENT' ? kind : undefined,
      overdue: overdue === 'true',
    });
  }

  @RequirePermissions('payout.approve')
  @Post(':id/paid')
  @HttpCode(204)
  async markPaid(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SettlementPaidDto, @Req() req: Request) {
    await this.settlements.markPaid(p, id, body, requestMeta(req));
  }
}
