import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TariffImportDto, TariffLookupDto, TariffSearchDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { Public, RequirePermissions } from '../auth/decorators';
import { TariffsService } from './tariffs.service';

const TARIFF_UPLOAD = FileInterceptor('file', { limits: { fileSize: 26 * 1024 * 1024, files: 1 } });

/** Public: HS descriptions, duty rates and import restrictions for each country, from IIE's imported schedules. */
@ApiTags('tariffs')
@Controller('tariffs')
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  @Public()
  @Get('coverage')
  coverage() {
    return this.tariffs.coverage();
  }

  /** What applies to an HS code imported into a country (and for goods from `origin`, if given). */
  @Public()
  @Get('lookup')
  async lookup(@Query() q: TariffLookupDto) {
    return { result: await this.tariffs.lookup(q.country, q.hs, q.origin) };
  }

  @Public()
  @Get('search')
  search(@Query() q: TariffSearchDto) {
    return this.tariffs.search(q.country, q.q);
  }
}

@ApiTags('admin')
@Controller('admin/tariffs/imports')
export class AdminTariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  @RequirePermissions('config.manage')
  @Get()
  list() {
    return this.tariffs.listImports();
  }

  /** Multipart: `file` (CSV or .xlsx) plus name, source, effectiveFrom, countryCodes?, caricomDefaultPercent?. Creates a draft. */
  @RequirePermissions('config.manage')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(TARIFF_UPLOAD)
  import(@CurrentPrincipal() p: Principal, @Body() body: TariffImportDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.tariffs.importFile(p, body, file, requestMeta(req));
  }

  @RequirePermissions('config.manage')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tariffs.getImport(id);
  }

  @RequirePermissions('config.manage')
  @Post(':id/activate')
  @HttpCode(200)
  activate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tariffs.activate(p, id, requestMeta(req));
  }

  @RequirePermissions('config.manage')
  @Post(':id/discard')
  @HttpCode(204)
  async discard(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.tariffs.discard(id, requestMeta(req));
  }
}
