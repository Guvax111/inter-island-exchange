import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Image bytes. Public images are cacheable; private ones (drafts under review) are not. */
  @Public()
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    const file = await this.media.read(id, req.principal);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', file.isPublic ? 'public, max-age=3600' : 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.send(file.body);
  }
}
