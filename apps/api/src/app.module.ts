import { DynamicModule, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from './config/config';
import { createDatabase, DB, PG_POOL } from './db/db';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { OutboxPoller } from './outbox/outbox.poller';
import { createEmailProvider, EMAIL_PROVIDER, EmailProvider } from './email/email.provider';
import { NotificationDispatcher } from './email/notification.dispatcher';
import { RbacService } from './rbac/rbac.service';
import { SessionService } from './auth/session.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AUTH_RATE_LIMIT } from './auth/decorators';
import { AccountLifecycleService } from './users/account-lifecycle.service';
import { ProfilesService } from './profiles/profiles.service';
import { ProfilesController } from './profiles/profiles.controller';
import { CountriesService } from './countries/countries.service';
import { AdminCountriesController, CountriesController } from './countries/countries.controller';
import { AdminUsersService } from './admin/admin-users.service';
import { AdminController } from './admin/admin.controller';
import { HealthController } from './health.controller';
import { HttpExceptionFilter } from './common/http-exception.filter';

class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

export interface AppModuleOptions {
  /** Tests inject a SandboxEmailProvider to read sent messages. */
  emailProvider?: EmailProvider;
}

/**
 * Modular monolith root. Modules share one database but each service owns its tables (see
 * docs/IIE_PLATFORM_ARCHITECTURE.md §5). Split into Nest feature modules as the codebase grows.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, options: AppModuleOptions = {}): DynamicModule {
    const { db, pool } = createDatabase(config.DATABASE_URL);
    return {
      module: AppModule,
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MIN },
            {
              name: 'auth',
              ttl: 60_000,
              limit: config.AUTH_RATE_LIMIT_PER_MIN,
              skipIf: (ctx) => !Reflect.getMetadata(AUTH_RATE_LIMIT, ctx.getHandler()),
            },
          ],
        }),
      ],
      controllers: [AuthController, ProfilesController, CountriesController, AdminCountriesController, AdminController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DB, useValue: db },
        { provide: PG_POOL, useValue: pool },
        { provide: EMAIL_PROVIDER, useValue: options.emailProvider ?? createEmailProvider(config) },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        PoolShutdown,
        AuditService,
        OutboxService,
        OutboxPoller,
        NotificationDispatcher,
        RbacService,
        SessionService,
        AuthService,
        AccountLifecycleService,
        ProfilesService,
        CountriesService,
        AdminUsersService,
      ],
    };
  }
}
