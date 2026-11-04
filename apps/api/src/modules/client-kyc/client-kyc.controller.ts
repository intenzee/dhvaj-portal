import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ClientKyc,
  type KycRegisterResponse,
  type KycSettings,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ClientKycService } from './client-kyc.service';
import {
  CompleteClientKycDto,
  KycRegisterQueryDto,
  SaveClientKycDto,
  UpdateKycSettingsDto,
} from './dto/client-kyc.dto';

/**
 * Practice Services PS-404 — client KYC, behind ff_client_kyc (404 when off
 * for the caller's office). Everything needs entity.read: whoever sees the
 * client (RLS) collects its KYC, as the team does in practice; the service
 * decides who marks it complete (a manager or partner) and who sets the rules.
 */
@ApiTags('client-kyc')
@Controller()
export class ClientKycController {
  constructor(
    private readonly kyc: ClientKycService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('client-kyc')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: 'The KYC register: every active client and its KYC status' })
  register(
    @CurrentPrincipal() p: Principal,
    @Query() q: KycRegisterQueryDto,
  ): Promise<KycRegisterResponse> {
    this.gate(p);
    return this.kyc.register(rlsContextFromPrincipal(p), q);
  }

  @Get('client-kyc/settings')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: 'The KYC gate and review periods' })
  settings(@CurrentPrincipal() p: Principal): Promise<KycSettings> {
    this.gate(p);
    return this.kyc.settings(rlsContextFromPrincipal(p));
  }

  @Patch('client-kyc/settings')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: 'Set the KYC gate and review periods (managing partner / admin)' })
  updateSettings(
    @CurrentPrincipal() p: Principal,
    @Body() dto: UpdateKycSettingsDto,
  ): Promise<KycSettings> {
    this.gate(p);
    return this.kyc.updateSettings(rlsContextFromPrincipal(p), dto);
  }

  @Get('entities/:id/kyc')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: "A client's KYC (a pending one when nothing is on file)" })
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ClientKyc> {
    this.gate(p);
    return this.kyc.get(rlsContextFromPrincipal(p), id);
  }

  @Put('entities/:id/kyc')
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: "Save a client's KYC (reopens a complete one)" })
  save(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveClientKycDto,
  ): Promise<ClientKyc> {
    this.gate(p);
    return this.kyc.save(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('entities/:id/kyc/complete')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({ summary: "Mark a client's KYC complete (manager / partner)" })
  complete(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteClientKycDto,
  ): Promise<ClientKyc> {
    this.gate(p);
    return this.kyc.complete(rlsContextFromPrincipal(p), id, dto);
  }

  private gate(p: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.clientKyc, p.officeCode)) {
      throw new NotFoundException();
    }
  }
}
