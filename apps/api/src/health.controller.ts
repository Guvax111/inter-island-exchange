import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Database, DB } from './db/db';
import { Public } from './auth/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Public()
  @Get()
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
