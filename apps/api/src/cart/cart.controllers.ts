import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AddressCreateDto, CartAddDto, CartUpdateDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequireActiveAccount, RequirePermissions } from '../auth/decorators';
import { CartService } from './cart.service';
import { SavedService } from './saved.service';

@ApiTags('buyer')
@Controller('me/cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @RequirePermissions('cart.manage.own')
  @Get()
  get(@CurrentPrincipal() p: Principal) {
    return this.cart.get(p);
  }

  @RequireActiveAccount()
  @RequirePermissions('cart.manage.own')
  @Post('items')
  add(@CurrentPrincipal() p: Principal, @Body() body: CartAddDto) {
    return this.cart.add(p, body.variantId, body.quantity);
  }

  @RequireActiveAccount()
  @RequirePermissions('cart.manage.own')
  @Patch('items/:variantId')
  update(@CurrentPrincipal() p: Principal, @Param('variantId', ParseUUIDPipe) variantId: string, @Body() body: CartUpdateDto) {
    return this.cart.setQuantity(p, variantId, body.quantity);
  }

  @RequirePermissions('cart.manage.own')
  @Delete('items/:variantId')
  remove(@CurrentPrincipal() p: Principal, @Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.cart.remove(p, variantId);
  }

  @RequirePermissions('cart.manage.own')
  @Delete()
  clear(@CurrentPrincipal() p: Principal) {
    return this.cart.clear(p);
  }
}

@ApiTags('buyer')
@Controller('me')
export class SavedController {
  constructor(private readonly saved: SavedService) {}

  @RequirePermissions('saved.manage.own')
  @Get('saved/products')
  async products(@CurrentPrincipal() p: Principal) {
    return { items: await this.saved.listProducts(p) };
  }

  @RequirePermissions('saved.manage.own')
  @Put('saved/products/:id')
  @HttpCode(204)
  async saveProduct(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.saved.saveProduct(p, id);
  }

  @RequirePermissions('saved.manage.own')
  @Delete('saved/products/:id')
  @HttpCode(204)
  async unsaveProduct(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.saved.unsaveProduct(p, id);
  }

  @RequirePermissions('saved.manage.own')
  @Get('saved/sellers')
  async sellers(@CurrentPrincipal() p: Principal) {
    return { items: await this.saved.listSellers(p) };
  }

  @RequirePermissions('saved.manage.own')
  @Put('saved/sellers/:slug')
  @HttpCode(204)
  async saveSeller(@CurrentPrincipal() p: Principal, @Param('slug') slug: string) {
    await this.saved.saveSeller(p, slug);
  }

  @RequirePermissions('saved.manage.own')
  @Delete('saved/sellers/:slug')
  @HttpCode(204)
  async unsaveSeller(@CurrentPrincipal() p: Principal, @Param('slug') slug: string) {
    await this.saved.unsaveSeller(p, slug);
  }

  @RequirePermissions('profile.read.own')
  @Get('addresses')
  async addresses(@CurrentPrincipal() p: Principal) {
    return { items: await this.saved.listAddresses(p) };
  }

  @RequirePermissions('profile.update.own')
  @Post('addresses')
  async addAddress(@CurrentPrincipal() p: Principal, @Body() body: AddressCreateDto, @Req() req: Request) {
    return { items: await this.saved.addAddress(p, body, requestMeta(req)) };
  }

  @RequirePermissions('profile.update.own')
  @Post('addresses/:id/default')
  @HttpCode(200)
  async setDefault(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.saved.setDefaultAddress(p, id) };
  }

  @RequirePermissions('profile.update.own')
  @Delete('addresses/:id')
  async deleteAddress(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return { items: await this.saved.deleteAddress(p, id, requestMeta(req)) };
  }
}
