import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type MaterialityMethodologyLibrary,
  type MaterialityMethodologyRuleRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CreateMaterialityRuleVersionDto } from './dto/materiality-library.dto';
import { MaterialityMethodologyLibraryService } from './materiality-methodology-library';

/**
 * Materiality Methodology Library administration (DHVAJ 03.3 §8, §23):
 * benchmark / percentage guidance, applicability, considerations and the
 * override (Partner Attention) rule. Insert-only — every change appends a
 * version. Methodology only: no client data and no conclusion authority.
 */
@ApiTags('materiality-methodology-library')
@Controller('materiality-methodology-library')
export class MaterialityMethodologyLibraryController {
  constructor(private readonly library: MaterialityMethodologyLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Every rule version in the materiality methodology library' })
  list(@CurrentPrincipal() principal: Principal): Promise<MaterialityMethodologyLibrary> {
    return this.library.list(rlsContextFromPrincipal(principal));
  }

  @Post('rules')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append a materiality methodology rule version (or a new rule)' })
  addRule(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateMaterialityRuleVersionDto,
  ): Promise<MaterialityMethodologyRuleRecord> {
    return this.library.addRuleVersion(rlsContextFromPrincipal(principal), dto);
  }
}
