import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminUserQueryDto, AuditQueryDto, GrantRoleDto, ReasonDto } from '../common/dto';
import { requestMeta } from '../common/request';
import { Errors } from '../common/errors';
import type { Principal } from '../rbac/principal';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { RequirePermissions } from '../auth/decorators';
import { AdminUsersService } from './admin-users.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly usersService: AdminUsersService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('user.read.any')
  @Get('users')
  listUsers(@CurrentPrincipal() principal: Principal, @Query() query: AdminUserQueryDto) {
    return this.usersService.list(principal, query);
  }

  @RequirePermissions('user.read.any')
  @Get('users/:id')
  getUser(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.get(principal, id);
  }

  @RequirePermissions('user.suspend')
  @Post('users/:id/suspend')
  @HttpCode(204)
  async suspend(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @Req() req: Request) {
    await this.usersService.suspend(p, id, body.reason, requestMeta(req));
  }

  @RequirePermissions('user.suspend')
  @Post('users/:id/reactivate')
  @HttpCode(204)
  async reactivate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @Req() req: Request) {
    await this.usersService.reactivate(p, id, body.reason, requestMeta(req));
  }

  @RequirePermissions('user.roles.manage')
  @Post('users/:id/roles')
  @HttpCode(204)
  async grantRole(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: GrantRoleDto, @Req() req: Request) {
    await this.usersService.grantRole(p, id, body.role, body.countryCode, requestMeta(req));
  }

  @RequirePermissions('user.roles.manage')
  @Delete('users/:id/roles/:assignmentId')
  @HttpCode(204)
  async revokeRole(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ) {
    await this.usersService.revokeRole(p, id, assignmentId, requestMeta(req));
  }

  @RequirePermissions('user.read.any')
  @Get('roles')
  async roles() {
    return { items: await this.usersService.listRoles() };
  }

  /** Platform-wide audit reading. A country-scoped audit view is planned for Phase 7. */
  @RequirePermissions('audit.read')
  @Get('audit-logs')
  auditLogs(@CurrentPrincipal() p: Principal, @Query() query: AuditQueryDto) {
    if (!p.canGlobally('audit.read')) throw Errors.forbidden('Country-scoped audit access is not available yet');
    return this.audit.list(query);
  }
}
