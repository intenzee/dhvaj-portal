import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type DscListResponse,
  type DscTokenDetail,
  type RevealedDscPin,
} from '@hsdg/contracts';
import {
  CurrentPrincipal,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { DscRegisterService } from './dsc-register.service';
import { canManageRegisters, requireRegisters } from './udin-register.controller';
import {
  CheckInDscDto,
  CheckOutDscDto,
  CreateDscTokenDto,
  DscListQueryDto,
  ReleaseDscDto,
  SetDscPinDto,
  UpdateDscTokenDto,
} from './dto/registers.dto';

const PIN_KEEPERS = 'Only a partner or manager of the client’s office can keep a DSC PIN.';

const canKeepPins = (p: Principal) => p.permissions.includes(PERMISSION.credentialManage);

/**
 * Practice Services PS-305 — the DSC register and custody. Behind
 * ff_registers. Anyone who reads engagements sees the tokens of their office
 * and of the clients they can see, and checks them out and in; adding,
 * editing and releasing a token need register.manage. The PIN follows the
 * logins vault (ADR-0035): credential.manage to keep it, credential.reveal
 * (and the vault's own checks) to see it.
 */
@ApiTags('registers')
@Controller('registers/dsc')
export class DscRegisterController {
  constructor(
    private readonly dsc: DscRegisterService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'DSC tokens of the caller’s office and visible clients' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: DscListQueryDto,
  ): Promise<DscListResponse> {
    requireRegisters(this.flags, principal);
    return this.dsc.list(rlsContextFromPrincipal(principal), query, canManageRegisters(principal));
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'One token, with its movements' })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    return this.pinGate(principal, await this.dsc.get(rlsContextFromPrincipal(principal), id));
  }

  @Post()
  @RequirePermissions(PERMISSION.registerManage)
  @ApiOperation({ summary: 'Add a token to the register (its PIN, if given, goes to the vault)' })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateDscTokenDto,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    if (body.pin && !canKeepPins(principal)) throw new ForbiddenException(PIN_KEEPERS);
    return this.pinGate(principal, await this.dsc.create(rlsContextFromPrincipal(principal), body));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.registerManage)
  @ApiOperation({ summary: 'Edit a token’s details' })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDscTokenDto,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    return this.pinGate(
      principal,
      await this.dsc.update(rlsContextFromPrincipal(principal), id, body),
    );
  }

  @Post(':id/check-out')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'Take a token out of the office, with who, why and when back' })
  async checkOut(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CheckOutDscDto,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    return this.pinGate(
      principal,
      await this.dsc.checkOut(rlsContextFromPrincipal(principal), id, body),
    );
  }

  @Post(':id/check-in')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.registerManage)
  @ApiOperation({ summary: 'A token is back in the office' })
  async checkIn(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CheckInDscDto,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    return this.pinGate(
      principal,
      await this.dsc.checkIn(rlsContextFromPrincipal(principal), id, body),
    );
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.registerManage)
  @ApiOperation({ summary: 'Returned to its holder, or lost: the token leaves the register' })
  async release(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReleaseDscDto,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    return this.pinGate(
      principal,
      await this.dsc.release(rlsContextFromPrincipal(principal), id, body),
    );
  }

  @Put(':id/pin')
  @RequirePermissions(PERMISSION.credentialManage)
  @ApiOperation({ summary: 'Keep (or replace) the token’s PIN in the logins vault' })
  async setPin(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetDscPinDto,
  ): Promise<DscTokenDetail> {
    requireRegisters(this.flags, principal);
    return this.pinGate(
      principal,
      await this.dsc.setPin(rlsContextFromPrincipal(principal), id, body.pin),
    );
  }

  @Post(':id/pin/reveal')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(PERMISSION.credentialReveal)
  @ApiOperation({
    summary: 'Show the token’s PIN',
    description: 'Through the vault’s reveal: logged, and 60 an hour at most.',
  })
  revealPin(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevealedDscPin> {
    requireRegisters(this.flags, principal);
    return this.dsc.revealPin(rlsContextFromPrincipal(principal), id);
  }

  /** The PIN controls show only to someone who can keep a PIN at all. */
  private pinGate(principal: Principal, d: DscTokenDetail): DscTokenDetail {
    return canKeepPins(principal) ? d : { ...d, canPin: false };
  }
}
