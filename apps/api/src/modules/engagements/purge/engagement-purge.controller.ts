import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import {
  EngagementPurgeService,
  type EngagementPurgePreview,
  type EngagementPurgeResult,
} from './engagement-purge.service';

export class EngagementCodeQueryDto {
  @ApiProperty({ description: 'The engagement code, e.g. ENG00012' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;
}

export class PurgeEngagementDto {
  @ApiProperty({ description: 'The engagement code, typed again to confirm' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  confirmCode!: string;
}

@ApiTags('engagements')
@Controller('engagement-purge')
export class EngagementPurgeController {
  constructor(private readonly purge: EngagementPurgeService) {}

  @Get()
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'What deleting an engagement would remove (administrator only)',
    description: 'Found by its code — an administrator need not be on the engagement.',
  })
  preview(
    @CurrentPrincipal() principal: Principal,
    @Query() query: EngagementCodeQueryDto,
  ): Promise<EngagementPurgePreview> {
    return this.purge.preview(rlsContextFromPrincipal(principal), query.code);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Delete an engagement permanently (administrator only, audited)',
    description:
      'Removes the engagement and everything under it — tasks, documents and their files, ' +
      'filings, time, invoices, credit notes, working papers, its audit trail — and every ' +
      'engagement merged into it. Receipts stay, unallocated. Cannot be undone.',
  })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PurgeEngagementDto,
  ): Promise<EngagementPurgeResult> {
    return this.purge.purge(rlsContextFromPrincipal(principal), id, dto.confirmCode);
  }
}
