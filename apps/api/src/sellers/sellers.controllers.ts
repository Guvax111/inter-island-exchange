import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AdminSellerQueryDto, PayoutSetupDto, ReasonDto, ReviewDecisionDto, SellerDocumentReviewDto, SellerDocumentUploadDto, SellerProfileUpdateDto, StorefrontUpdateDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { UPLOAD } from '../catalog/catalog.controllers';
import { SellersService } from './sellers.service';
import { SellerDocumentsService } from './seller-documents.service';

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

const DOCUMENT_UPLOAD = FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

/** Proof of business registration or national ID: uploaded by the seller, reviewed by IIE. */
@ApiTags('seller')
@Controller()
export class SellerDocumentsController {
  constructor(private readonly documents: SellerDocumentsService) {}

  @RequirePermissions('product.manage.own')
  @Get('me/seller/documents')
  mine(@CurrentPrincipal() p: Principal) {
    return this.documents.listMine(p);
  }

  @RequirePermissions('product.manage.own')
  @Post('me/seller/documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(DOCUMENT_UPLOAD)
  upload(@CurrentPrincipal() p: Principal, @Body() body: SellerDocumentUploadDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.documents.upload(p, body.type, file, requestMeta(req));
  }

  /** Download for the seller or a reviewer. Always an attachment, never rendered in the page. */
  @RequirePermissions('profile.read.own')
  @Get('seller-documents/:id')
  async download(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.documents.download(p, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(file.body);
  }

  @RequirePermissions('seller.review')
  @Post('admin/seller-documents/:id/review')
  @HttpCode(204)
  async review(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: SellerDocumentReviewDto, @Req() req: Request) {
    await this.documents.review(p, id, body.decision, body.note, requestMeta(req));
  }
}
