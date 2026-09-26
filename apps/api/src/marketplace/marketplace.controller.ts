import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductSearchDto, SellerQueryDto } from '../common/dto';
import { Public } from '../auth/decorators';
import { MarketplaceService } from './marketplace.service';

@ApiTags('marketplace')
@Controller()
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Public()
  @Get('products')
  search(@Query() query: ProductSearchDto) {
    return this.marketplace.search(query);
  }

  @Public()
  @Get('products/:id')
  product(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketplace.product(id);
  }

  @Public()
  @Get('sellers')
  async sellers(@Query() query: SellerQueryDto) {
    return { items: await this.marketplace.sellers(query.country) };
  }

  @Public()
  @Get('sellers/:slug')
  storefront(@Param('slug') slug: string) {
    return this.marketplace.storefront(slug);
  }
}
