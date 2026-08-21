import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { IdentityService } from './identity.service';
import type { OfficeRecord } from './identity.types';
import { CreateOfficeDto } from './dto/create-office.dto';
import { UpdateOfficeDto } from './dto/update-office.dto';

@ApiTags('offices')
@Controller('offices')
export class OfficesController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @RequirePermissions(PERMISSION.officeRead)
  @ApiOperation({ summary: 'List offices' })
  list(@CurrentPrincipal() principal: Principal): Promise<OfficeRecord[]> {
    return this.identity.listOffices(rlsContextFromPrincipal(principal));
  }

  @Post()
  @RequirePermissions(PERMISSION.officeManage)
  @ApiOperation({
    summary: 'Create an office (audited)',
    description: 'Requires firm-wide authority (RLS). Office code must be unique.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateOfficeDto,
  ): Promise<OfficeRecord> {
    return this.identity.createOffice(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.officeManage)
  @ApiOperation({ summary: 'Update an office (audited, records before/after)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOfficeDto,
  ): Promise<OfficeRecord> {
    return this.identity.updateOffice(rlsContextFromPrincipal(principal), id, dto);
  }
}
