import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminTransactionQueryDto,
  CancelOrderDto,
  CheckoutQuoteDto,
  DutyEstimateDto,
  DutyEstimateUpdateDto,
  FeeRuleUpdateDto,
  MarkReadDto,
  PlaceOrderDto,
  ShippingRateDto,
  ShippingRateUpdateDto,
} from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequireActiveAccount, RequirePermissions } from '../auth/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { CheckoutService } from './checkout.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import { OrdersService } from './orders.service';

@ApiTags('buyer')
@Controller('me')
export class BuyerOrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  @RequireActiveAccount()
  @RequirePermissions('order.create')
  @Post('checkout/quote')
  @HttpCode(200)
  quote(@CurrentPrincipal() p: Principal, @Body() body: CheckoutQuoteDto) {
    return this.checkout.quote(p, body.sellerSlug, body.addressId);
  }

  @RequireActiveAccount()
  @RequirePermissions('order.create')
  @Post('checkout')
  place(@CurrentPrincipal() p: Principal, @Body() body: PlaceOrderDto, @Req() req: Request) {
    return this.checkout.placeOrder(p, body.quoteId, requestMeta(req));
  }

  @RequirePermissions('order.read.own')
  @Get('orders')
  async list(@CurrentPrincipal() p: Principal) {
    return { items: await this.orders.listForBuyer(p) };
  }

  @RequirePermissions('order.read.own')
  @Get('orders/:iieId')
  get(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    return this.orders.getForBuyer(p, iieId);
  }

  @RequirePermissions('order.create')
  @Post('orders/:iieId/cancel')
  @HttpCode(200)
  cancel(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: CancelOrderDto, @Req() req: Request) {
    return this.orders.cancelByBuyer(p, iieId, body.reason, requestMeta(req));
  }
}

@ApiTags('seller')
@Controller('me/sales')
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermissions('order.fulfil.own')
  @Get()
  async list(@CurrentPrincipal() p: Principal) {
    return { items: await this.orders.listForSeller(p) };
  }

  @RequirePermissions('order.fulfil.own')
  @Get(':iieId')
  get(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    return this.orders.getForSeller(p, iieId);
  }
}

@ApiTags('notifications')
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @RequirePermissions('profile.read.own')
  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.notifications.list(p.userId);
  }

  @RequirePermissions('profile.read.own')
  @Post('read')
  @HttpCode(204)
  async read(@CurrentPrincipal() p: Principal, @Body() body: MarkReadDto) {
    await this.notifications.markRead(p.userId, body.ids);
  }
}

@ApiTags('admin')
@Controller('admin')
export class AdminTransactionsController {
  constructor(
    private readonly orders: OrdersService,
    private readonly settings: CheckoutSettingsService,
  ) {}

  @RequirePermissions('transaction.read.any')
  @Get('transactions')
  list(@CurrentPrincipal() p: Principal, @Query() q: AdminTransactionQueryDto) {
    return this.orders.listForAdmin(p, q);
  }

  @RequirePermissions('transaction.read.any')
  @Get('transactions/:iieId')
  get(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    return this.orders.getForAdmin(p, iieId);
  }

  @RequirePermissions('config.manage')
  @Get('shipping-rates')
  async rates() {
    return { items: await this.settings.listShippingRates() };
  }

  @RequirePermissions('config.manage')
  @Post('shipping-rates')
  async addRate(@Body() body: ShippingRateDto, @Req() req: Request) {
    return { items: await this.settings.addShippingRate(body, requestMeta(req)) };
  }

  @RequirePermissions('config.manage')
  @Patch('shipping-rates/:id')
  async updateRate(@Param('id', ParseUUIDPipe) id: string, @Body() body: ShippingRateUpdateDto, @Req() req: Request) {
    return { items: await this.settings.updateShippingRate(id, body, requestMeta(req)) };
  }

  @RequirePermissions('config.manage')
  @Get('fee-rule')
  fee() {
    return this.settings.getFeeRule();
  }

  @RequirePermissions('config.manage')
  @Put('fee-rule')
  updateFee(@Body() body: FeeRuleUpdateDto, @Req() req: Request) {
    return this.settings.updateFeeRule(body, requestMeta(req));
  }

  @RequirePermissions('config.manage')
  @Get('duty-estimates')
  async duties() {
    return { items: await this.settings.listDutyEstimates() };
  }

  @RequirePermissions('config.manage')
  @Post('duty-estimates')
  async addDuty(@Body() body: DutyEstimateDto, @Req() req: Request) {
    return { items: await this.settings.addDutyEstimate(body, requestMeta(req)) };
  }

  @RequirePermissions('config.manage')
  @Patch('duty-estimates/:id')
  async updateDuty(@Param('id', ParseUUIDPipe) id: string, @Body() body: DutyEstimateUpdateDto, @Req() req: Request) {
    return { items: await this.settings.updateDutyEstimate(id, body, requestMeta(req)) };
  }
}
