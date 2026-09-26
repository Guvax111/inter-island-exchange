import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminShipmentQueryDto,
  DeliveryProofDto,
  PartnerCreateDto,
  PartnerLaneDto,
  PartnerMemberInviteDto,
  PartnerUpdateDto,
  ReadyForPickupDto,
  ReportProblemDto,
  ShipmentAssignDto,
  ShipmentStepDto,
} from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { PartnersService } from './partners.service';
import { ShipmentsService } from './shipments.service';

/** Proof-of-delivery uploads: an optional photo and an optional signature image. */
const PROOF_UPLOADS = FileFieldsInterceptor(
  [
    { name: 'photo', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
  ],
  { limits: { fileSize: 20 * 1024 * 1024, files: 2 } },
);

@ApiTags('seller')
@Controller('me/sales')
export class SellerShipmentController {
  constructor(private readonly shipments: ShipmentsService) {}

  @RequirePermissions('order.fulfil.own')
  @Post(':iieId/ready')
  readyForPickup(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: ReadyForPickupDto, @Req() req: Request) {
    return this.shipments.readyForPickup(p, iieId, body, requestMeta(req));
  }
}

@ApiTags('buyer')
@Controller('me/orders')
export class BuyerDeliveryController {
  constructor(private readonly shipments: ShipmentsService) {}

  @RequirePermissions('order.read.own')
  @Post(':iieId/confirm-delivery')
  @HttpCode(204)
  async confirm(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Req() req: Request) {
    await this.shipments.confirmDelivery(p, iieId, requestMeta(req));
  }

  @RequirePermissions('dispute.create.own')
  @Post(':iieId/report-problem')
  @HttpCode(204)
  async report(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: ReportProblemDto, @Req() req: Request) {
    await this.shipments.reportProblem(p, iieId, body.reason, requestMeta(req));
  }
}

/** The IIE partner portal: logistics partners and customs brokers see and update only their assigned shipments. */
@ApiTags('partner')
@Controller('partner/shipments')
export class PartnerPortalController {
  constructor(private readonly shipments: ShipmentsService) {}

  @RequirePermissions('shipment.read.assigned')
  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.shipments.listForPartner(p);
  }

  @RequirePermissions('shipment.read.assigned')
  @Get(':iieId')
  detail(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    return this.shipments.detailForPartner(p, iieId);
  }

  @RequirePermissions('shipment.read.assigned')
  @Get(':iieId/commercial-invoice')
  invoice(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    return this.shipments.commercialInvoice(p, iieId);
  }

  @RequirePermissions('shipment.read.assigned')
  @Post(':iieId/steps')
  @HttpCode(200)
  step(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: ShipmentStepDto, @Req() req: Request) {
    return this.shipments.step(p, iieId, body, requestMeta(req));
  }

  @RequirePermissions('shipment.update.assigned')
  @Post(':iieId/delivery')
  @HttpCode(200)
  @UseInterceptors(PROOF_UPLOADS)
  deliver(
    @CurrentPrincipal() p: Principal,
    @Param('iieId') iieId: string,
    @Body() body: DeliveryProofDto,
    @UploadedFiles() files: { photo?: Express.Multer.File[]; signature?: Express.Multer.File[] } | undefined,
    @Req() req: Request,
  ) {
    return this.shipments.deliver(p, iieId, body, { photo: files?.photo?.[0], signature: files?.signature?.[0] }, requestMeta(req));
  }
}

@ApiTags('admin')
@Controller('admin')
export class AdminLogisticsController {
  constructor(
    private readonly partners: PartnersService,
    private readonly shipments: ShipmentsService,
  ) {}

  @RequirePermissions('partner.manage')
  @Get('partners')
  list() {
    return this.partners.list();
  }

  @RequirePermissions('partner.manage')
  @Post('partners')
  create(@Body() body: PartnerCreateDto, @Req() req: Request) {
    return this.partners.create(body, requestMeta(req));
  }

  @RequirePermissions('partner.manage')
  @Patch('partners/:id')
  @HttpCode(204)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: PartnerUpdateDto, @Req() req: Request) {
    await this.partners.update(id, body, requestMeta(req));
  }

  @RequirePermissions('partner.manage')
  @Post('partners/:id/lanes')
  @HttpCode(204)
  async addLane(@Param('id', ParseUUIDPipe) id: string, @Body() body: PartnerLaneDto, @Req() req: Request) {
    await this.partners.addLane(id, body.origin, body.destination, requestMeta(req));
  }

  @RequirePermissions('partner.manage')
  @Delete('partners/:id/lanes/:laneId')
  @HttpCode(204)
  async removeLane(@Param('id', ParseUUIDPipe) id: string, @Param('laneId', ParseUUIDPipe) laneId: string, @Req() req: Request) {
    await this.partners.removeLane(id, laneId, requestMeta(req));
  }

  @RequirePermissions('partner.manage')
  @Post('partners/:id/members')
  invite(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: PartnerMemberInviteDto, @Req() req: Request) {
    return this.partners.inviteMember(p, id, body, requestMeta(req));
  }

  @RequirePermissions('partner.manage')
  @Delete('partners/:id/members/:userId')
  @HttpCode(204)
  async removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: Request) {
    await this.partners.removeMember(id, userId, requestMeta(req));
  }

  @RequirePermissions('transaction.read.any')
  @Get('shipments')
  shipmentList(@CurrentPrincipal() p: Principal, @Query() q: AdminShipmentQueryDto) {
    return this.shipments.listForAdmin(p, q.view);
  }

  @RequirePermissions('partner.manage')
  @Patch('shipments/:iieId')
  @HttpCode(204)
  async assign(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: ShipmentAssignDto, @Req() req: Request) {
    await this.shipments.assign(p, iieId, body, requestMeta(req));
  }
}
