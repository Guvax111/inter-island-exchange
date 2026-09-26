import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminProductQueryDto,
  CategoryCreateDto,
  CategoryUpdateDto,
  ImageUploadDto,
  InventoryAdjustDto,
  ProductCreateDto,
  ProductUpdateDto,
  ReasonDto,
  ReviewDecisionDto,
  VariantCreateDto,
  VariantUpdateDto,
} from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { Public, RequirePermissions } from '../auth/decorators';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';

/** Hard cap before the file reaches the service, which applies the configured MAX_UPLOAD_MB. */
export const UPLOAD = FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  async tree() {
    return { items: await this.categories.tree() };
  }
}

@ApiTags('admin')
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermissions('category.manage')
  @Get()
  async tree() {
    return { items: await this.categories.tree(true) };
  }

  @RequirePermissions('category.manage')
  @Post()
  create(@Body() body: CategoryCreateDto, @Req() req: Request) {
    return this.categories.create(body, requestMeta(req));
  }

  @RequirePermissions('category.manage')
  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() body: CategoryUpdateDto, @Req() req: Request) {
    return this.categories.update(slug, body, requestMeta(req));
  }
}

@ApiTags('seller')
@Controller('me/products')
export class SellerProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequirePermissions('product.manage.own')
  @Get()
  async list(@CurrentPrincipal() p: Principal) {
    return { items: await this.products.listMine(p) };
  }

  @RequirePermissions('product.manage.own')
  @Post()
  create(@CurrentPrincipal() p: Principal, @Body() body: ProductCreateDto, @Req() req: Request) {
    return this.products.create(p, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.getMine(p, id);
  }

  @RequirePermissions('product.manage.own')
  @Patch(':id')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProductUpdateDto, @Req() req: Request) {
    return this.products.update(p, id, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post(':id/variants')
  addVariant(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: VariantCreateDto, @Req() req: Request) {
    return this.products.addVariant(p, id, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Patch(':id/variants/:variantId')
  updateVariant(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: VariantUpdateDto,
    @Req() req: Request,
  ) {
    return this.products.updateVariant(p, id, variantId, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Put(':id/variants/:variantId/stock')
  setStock(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: InventoryAdjustDto,
    @Req() req: Request,
  ) {
    return this.products.setStock(p, id, variantId, body, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post(':id/images')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UPLOAD)
  addImage(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ImageUploadDto,
    @Req() req: Request,
  ) {
    return this.products.addImage(p, id, file, body.altText, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post(':id/images/:imageId/delete')
  @HttpCode(200)
  removeImage(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string, @Req() req: Request) {
    return this.products.removeImage(p, id, imageId, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.products.submit(p, id, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.products.archive(p, id, true, requestMeta(req));
  }

  @RequirePermissions('product.manage.own')
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.products.archive(p, id, false, requestMeta(req));
  }
}

@ApiTags('admin')
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequirePermissions('product.review')
  @Get()
  list(@CurrentPrincipal() p: Principal, @Query() q: AdminProductQueryDto) {
    return this.products.listForReview(p, q.status, q.page, q.pageSize);
  }

  @RequirePermissions('product.review')
  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.getForReview(p, id);
  }

  @RequirePermissions('product.review')
  @Post(':id/review')
  @HttpCode(204)
  async review(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDecisionDto, @Req() req: Request) {
    await this.products.review(p, id, body, requestMeta(req));
  }

  @RequirePermissions('product.review')
  @Post(':id/suspend')
  @HttpCode(204)
  async suspend(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @Req() req: Request) {
    await this.products.setSuspended(p, id, true, body.reason, requestMeta(req));
  }

  @RequirePermissions('product.review')
  @Post(':id/reinstate')
  @HttpCode(204)
  async reinstate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @Req() req: Request) {
    await this.products.setSuspended(p, id, false, body.reason, requestMeta(req));
  }
}
