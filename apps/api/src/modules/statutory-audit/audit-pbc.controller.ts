import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditPbc } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditPbcService } from './audit-pbc.service';
import { CreatePbcItemDto, SetPbcStatusDto, UpdatePbcItemDto } from './dto/pbc.dto';

/**
 * Statutory Audit — PBC Master Client Information Tracker endpoints (Audit Spec §16).
 * The client information-request layer linked to work. Reads gated by
 * `engagement.read`, mutations by `engagement.manage`; RLS does the real gating
 * (members read; only leads mutate). The tracker opens once Planning is approved.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditPbcController {
  constructor(private readonly pbc: AuditPbcService) {}

  @Get(':id/statutory-audit/pbc')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's PBC master tracker (§16)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditPbc[]> {
    return this.pbc.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/pbc')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Add a PBC request (§16)',
    description: 'The tracker is populated once Planning is approved (409 otherwise).',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePbcItemDto,
  ): Promise<StatutoryAuditPbc> {
    return this.pbc.createItem(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/pbc/:pbcId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a PBC request (§16)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pbcId', new ParseUUIDPipe()) pbcId: string,
    @Body() dto: UpdatePbcItemDto,
  ): Promise<StatutoryAuditPbc> {
    return this.pbc.updateItem(rlsContextFromPrincipal(principal), id, pbcId, dto);
  }

  @Post(':id/statutory-audit/pbc/:pbcId/status')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Transition a PBC status (§16)',
    description:
      'A "rejected" status requires a reason (400); "received" stamps the received date.',
  })
  setStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pbcId', new ParseUUIDPipe()) pbcId: string,
    @Body() dto: SetPbcStatusDto,
  ): Promise<StatutoryAuditPbc> {
    return this.pbc.setStatus(rlsContextFromPrincipal(principal), id, pbcId, dto);
  }

  @Delete(':id/statutory-audit/pbc/:pbcId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Delete a PBC request (§16)' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pbcId', new ParseUUIDPipe()) pbcId: string,
  ): Promise<StatutoryAuditPbc> {
    return this.pbc.deleteItem(rlsContextFromPrincipal(principal), id, pbcId);
  }
}
