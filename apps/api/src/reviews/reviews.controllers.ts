import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReviewDto, ReviewModerationDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequireActiveAccount, RequirePermissions } from '../auth/decorators';
import { ReviewsService } from './reviews.service';

@ApiTags('buyer')
@Controller('me/orders')
export class BuyerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Rate an order (1-5) with an optional written review. Published after IIE approves it. */
  @RequireActiveAccount()
  @RequirePermissions('order.read.own')
  @Post(':iieId/review')
  submit(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: ReviewDto, @Req() req: Request) {
    return this.reviews.submit(p, iieId, body, requestMeta(req));
  }
}

@ApiTags('admin')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @RequirePermissions('review.moderate')
  @Get()
  queue(@CurrentPrincipal() p: Principal, @Query('status') status?: string) {
    return this.reviews.queue(p, status === 'PUBLISHED' || status === 'REJECTED' ? status : 'PENDING');
  }

  @RequirePermissions('review.moderate')
  @Post(':id/moderate')
  @HttpCode(204)
  async moderate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewModerationDto, @Req() req: Request) {
    await this.reviews.moderate(p, id, body, requestMeta(req));
  }
}
