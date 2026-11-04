import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { PERMISSION, type ServiceLineLeadResult } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { StreamLeadService } from './stream-lead.service';

export class SetServiceLineLeadDto {
  @ApiProperty({ nullable: true, type: String, description: 'The new lead, or null for none' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  employeeId!: string | null;
}

@ApiTags('engagements')
@Controller('engagements/:id/service-lines/:lineId/lead')
export class StreamLeadController {
  constructor(private readonly leads: StreamLeadService) {}

  @Put()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Change a stream’s lead (administrator or Managing Partner only, audited)',
  })
  set(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: SetServiceLineLeadDto,
  ): Promise<ServiceLineLeadResult> {
    return this.leads.setLead(
      rlsContextFromPrincipal(principal),
      id,
      lineId,
      dto.employeeId ?? null,
    );
  }
}
