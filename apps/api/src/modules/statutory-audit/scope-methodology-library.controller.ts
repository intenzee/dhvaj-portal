import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ScopeMethodologyItemRecord,
  type ScopeMethodologyLibrary,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CreateScopeMethodologyItemVersionDto } from './dto/scope-library.dto';
import { ScopeMethodologyLibraryService } from './scope-methodology-library';

/**
 * 03.4 Methodology Library administration (DHVAJ 03.4 §31): controls cycles,
 * timing areas, evidence channels and technology uses with their answers,
 * hints and guidance. Insert-only — every change appends a version.
 * Methodology only: no client data and no conclusion authority.
 */
@ApiTags('scope-methodology-library')
@Controller('scope-methodology-library')
export class ScopeMethodologyLibraryController {
  constructor(private readonly library: ScopeMethodologyLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Every item version in the 03.4 methodology library' })
  list(@CurrentPrincipal() principal: Principal): Promise<ScopeMethodologyLibrary> {
    return this.library.list(rlsContextFromPrincipal(principal));
  }

  @Post('items')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append a 03.4 methodology item version (or a new item)' })
  addItem(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateScopeMethodologyItemVersionDto,
  ): Promise<ScopeMethodologyItemRecord> {
    return this.library.addItemVersion(rlsContextFromPrincipal(principal), dto);
  }
}
