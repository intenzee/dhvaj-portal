import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type UdinEntry,
  type UdinListResponse,
  type UdinPartnerOption,
  type UdinPendingResponse,
} from '@hsdg/contracts';
import {
  CurrentPrincipal,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { UdinRegisterService } from './udin-register.service';
import {
  CreateUdinDto,
  RevokeUdinDto,
  UdinListQueryDto,
  UdinPendingQueryDto,
} from './dto/registers.dto';

export const canManageRegisters = (p: Principal) =>
  p.permissions.includes(PERMISSION.registerManage);

export function requireRegisters(flags: FeatureFlagsService, principal: Principal): void {
  if (!flags.isOnFor(FEATURE_FLAG.registers, principal.officeCode)) throw new NotFoundException();
}

/**
 * Practice Services PS-304 — the UDIN register. Behind ff_registers (404 when
 * off for the caller's office). Anyone who reads engagements, or keeps the
 * registers, sees the entries of clients they can see (RLS); adding and
 * revoking need register.manage.
 */
@ApiTags('registers')
@Controller('registers/udin')
export class UdinRegisterController {
  constructor(
    private readonly udin: UdinRegisterService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'UDINs of the clients the caller can see' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: UdinListQueryDto,
  ): Promise<UdinListResponse> {
    requireRegisters(this.flags, principal);
    return this.udin.list(rlsContextFromPrincipal(principal), query, canManageRegisters(principal));
  }

  @Get('pending')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'Reports signed without a UDIN, against the firm’s window' })
  pending(
    @CurrentPrincipal() principal: Principal,
    @Query() query: UdinPendingQueryDto,
  ): Promise<UdinPendingResponse> {
    requireRegisters(this.flags, principal);
    return this.udin.pending(rlsContextFromPrincipal(principal), query);
  }

  @Get('partners')
  @RequirePermissions(PERMISSION.registerManage)
  @ApiOperation({ summary: 'Partners who can sign, for adding a UDIN' })
  partners(@CurrentPrincipal() principal: Principal): Promise<UdinPartnerOption[]> {
    requireRegisters(this.flags, principal);
    return this.udin.partners(rlsContextFromPrincipal(principal));
  }

  @Get('csv')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'The UDIN register as CSV (for peer review)' })
  async csv(
    @CurrentPrincipal() principal: Principal,
    @Query() query: UdinListQueryDto,
  ): Promise<StreamableFile> {
    requireRegisters(this.flags, principal);
    const csv = await this.udin.csv(rlsContextFromPrincipal(principal), query);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="udin-register.csv"',
    });
  }

  @Post()
  @RequirePermissions(PERMISSION.registerManage)
  @ApiOperation({ summary: 'Add a UDIN to the register' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateUdinDto,
  ): Promise<UdinEntry> {
    requireRegisters(this.flags, principal);
    return this.udin.create(rlsContextFromPrincipal(principal), body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.registerManage)
  @ApiOperation({ summary: 'Revoke a UDIN, with the reason (it stays in the register)' })
  revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RevokeUdinDto,
  ): Promise<UdinEntry> {
    requireRegisters(this.flags, principal);
    return this.udin.revoke(rlsContextFromPrincipal(principal), id, body);
  }
}
