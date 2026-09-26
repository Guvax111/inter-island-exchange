import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminSellerQueryDto, PayoutSetupDto, ReasonDto, ReviewDecisionDto, SellerProfileUpdateDto, StorefrontUpdateDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { UPLOAD } from '../catalog/catalog.controllers';
import { SellersService } from './sellers.service';

@ApiTags('seller')
@Controller('me')
export class SellerSelfController {
  constructor(private readonly sellers: SellersService) {}

  @RequirePermissions('product.manage.own')
  @Get('seller')
  mine(@CurrentPrincipal() p: Principal) {
    return this.sellers.mySeller(p);
  }

  @RequirePermissions('product.manage.own')
  @Patch('seller/profile')
  @HttpCode(204)
  async update(@CurrentPrincipal() p: Principal, @Body() body: SellerProfileUpdateDto, @Req() req: Request) {
    await this.sellers.updateMySellerProfile(p, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post('seller/resubmit')
  @HttpCode(204)
  async resubmit(@CurrentPrincipal() p: Principal, @Req() req: Request) {
    await this.sellers.resubmit(p, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Patch('storefront')
  storefront(@CurrentPrincipal() p: Principal, @Body() body: StorefrontUpdateDto, @Req() req: Request) {
    return this.sellers.updateStorefront(p, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post('storefront/logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UPLOAD)
  logo(@CurrentPrincipal() p: Principal, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.sellers.setLogo(p, file, requestMeta(req));
  }
}

@ApiTags('admin')
@Controller('admin/sellers')
export class AdminSellersController {
  constructor(private readonly sellers: SellersService) {}

  @RequirePermissions('seller.review')
  @Get()
  list(@CurrentPrincipal() p: Principal, @Query() q: AdminSellerQueryDto) {
    return this.sellers.listForReview(p, q.status, q.page, q.pageSize);
  }

  @RequirePermissions('seller.review')
  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.sellers.getForReview(p, id);
  }

  @RequirePermissions('seller.review')
  @Post(':id/review')
  @HttpCode(204)
  async review(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDecisionDto, @Req() req: Request) {
    await this.sellers.review(p, id, body, requestMeta(req));
  }

  @RequirePermissions('seller.review')
  @Post(':id/payout-setup')
  @HttpCode(204)
  async payoutSetup(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: PayoutSetupDto, @Req() req: Request) {
    await this.sellers.confirmPayoutSetup(p, id, body.note, requestMeta(req));
  }

  @RequirePermissions('seller.review')
  @Post(':id/suspend')
  @HttpCode(204)
  async suspend(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @Req() req: Request) {
    await this.sellers.suspend(p, id, body.reason, requestMeta(req));
  }

  @RequirePermissions('seller.review')
  @Post(':id/reinstate')
  @HttpCode(204)
  async reinstate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @Req() req: Request) {
    await this.sellers.reinstate(p, id, body.reason, requestMeta(req));
  }
}
