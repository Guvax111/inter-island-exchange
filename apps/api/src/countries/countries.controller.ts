import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CountryCreateDto, CountryUpdateDto, LaneDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { Public, RequirePermissions } from '../auth/decorators';
import { CountriesService } from './countries.service';

@ApiTags('countries')
@Controller()
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Public()
  /** CARICOM countries. `?scope=origins` adds countries used only as a product's country of origin. */
  @Get('countries')
  async list(@Query('scope') scope?: string) {
    return { items: await this.countries.list(scope === 'origins') };
  }

  @Public()
  @Get('countries/:key')
  get(@Param('key') key: string) {
    return this.countries.get(key);
  }

  @Public()
  @Get('currencies')
  async currencies() {
    return { items: await this.countries.listCurrencies() };
  }

  @Public()
  @Get('lanes')
  async lanes() {
    return { items: await this.countries.listLanes(true) };
  }
}

@ApiTags('admin')
@Controller('admin')
export class AdminCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @RequirePermissions('country.manage')
  @Get('countries/:key')
  get(@Param('key') key: string) {
    return this.countries.get(key, true);
  }

  @RequirePermissions('country.manage')
  @Post('countries')
  create(@CurrentPrincipal() principal: Principal, @Body() body: CountryCreateDto, @Req() req: Request) {
    return this.countries.create(principal, body, requestMeta(req));
  }

  @RequirePermissions('country.manage')
  @Patch('countries/:code')
  update(@CurrentPrincipal() principal: Principal, @Param('code') code: string, @Body() body: CountryUpdateDto, @Req() req: Request) {
    return this.countries.update(principal, code, body, requestMeta(req));
  }

  @RequirePermissions('country.manage')
  @Get('lanes')
  async lanes() {
    return { items: await this.countries.listLanes(false) };
  }

  @RequirePermissions('country.manage')
  @Put('lanes')
  @HttpCode(204)
  async setLane(@CurrentPrincipal() principal: Principal, @Body() body: LaneDto, @Req() req: Request) {
    await this.countries.setLane(principal, body, requestMeta(req));
  }
}
