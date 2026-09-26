import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { DisputeDecisionDto, DisputeMessageDto, ReportProblemDto } from '../common/dto';
import { requestMeta } from '../common/request';
import type { Principal } from '../rbac/principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { DisputesService } from './disputes.service';

class AdminDisputeQueryDto extends createZodDto(z.object({ status: z.enum(['OPEN', 'ALL']).default('OPEN') })) {}

const EVIDENCE_UPLOAD = FileInterceptor('photo', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

@ApiTags('disputes')
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /** The buyer reports a problem after delivery, until the review period ends. */
  @RequirePermissions('dispute.create.own')
  @Post('me/orders/:iieId/report-problem')
  @HttpCode(204)
  async report(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: ReportProblemDto, @Req() req: Request) {
    await this.disputes.open(p, iieId, body.reason, requestMeta(req));
  }

  /** The dispute for its buyer, its seller, or IIE staff. */
  @RequirePermissions('profile.read.own')
  @Get('disputes/:iieId')
  view(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string) {
    return this.disputes.view(p, iieId);
  }

  /** Message with an optional photo as evidence (multipart: `body`, `photo`). */
  @RequirePermissions('profile.read.own')
  @Post('disputes/:iieId/messages')
  @HttpCode(200)
  @UseInterceptors(EVIDENCE_UPLOAD)
  message(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: DisputeMessageDto, @UploadedFile() photo: Express.Multer.File | undefined, @Req() req: Request) {
    return this.disputes.message(p, iieId, body.body, photo, requestMeta(req));
  }

  @RequirePermissions('transaction.read.any')
  @Get('admin/disputes')
  list(@CurrentPrincipal() p: Principal, @Query() q: AdminDisputeQueryDto) {
    return this.disputes.listForAdmin(p, q.status);
  }

  @RequirePermissions('dispute.resolve')
  @Post('admin/disputes/:iieId/decision')
  @HttpCode(200)
  decide(@CurrentPrincipal() p: Principal, @Param('iieId') iieId: string, @Body() body: DisputeDecisionDto, @Req() req: Request) {
    return this.disputes.decide(p, iieId, body, requestMeta(req));
  }
}
