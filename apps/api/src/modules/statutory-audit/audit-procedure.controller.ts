import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditProcedures } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditProcedureService } from './audit-procedure.service';
import {
  AddEvidenceDto,
  AddExceptionDto,
  CreateProcedureDto,
  LinkAreaDto,
  LinkEvidenceDto,
  SetProcedureStateDto,
  UpdateExceptionDto,
  UpdateProcedureDto,
} from './dto/procedure.dto';

/**
 * Statutory Audit — Audit-Area Execution endpoints (Audit Spec §9–§14):
 * procedures, evidence, exceptions and the §14 reuse links. Reads gated by
 * `engagement.read`, mutations by `engagement.manage`; RLS does the real gating
 * (members read; only leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditProcedureController {
  constructor(private readonly procedures: AuditProcedureService) {}

  @Get(':id/statutory-audit/procedures')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's statutory-audit procedures (§9–§14)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditProcedures[]> {
    return this.procedures.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/areas/:workAreaId/procedures')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add a procedure to an audit area (§13)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workAreaId', new ParseUUIDPipe()) workAreaId: string,
    @Body() dto: CreateProcedureDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.createProcedure(rlsContextFromPrincipal(principal), id, workAreaId, dto);
  }

  @Post(':id/statutory-audit/procedures/:procedureId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update a procedure (§13)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Body() dto: UpdateProcedureDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.updateProcedure(
      rlsContextFromPrincipal(principal),
      id,
      procedureId,
      dto,
    );
  }

  @Post(':id/statutory-audit/procedures/:procedureId/state')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Transition a procedure state (§13)',
    description: 'Completing requires an objective, a conclusion and no open exceptions (400).',
  })
  setState(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Body() dto: SetProcedureStateDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.setState(rlsContextFromPrincipal(principal), id, procedureId, dto);
  }

  @Delete(':id/statutory-audit/procedures/:procedureId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Delete a procedure (§13)' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.deleteProcedure(rlsContextFromPrincipal(principal), id, procedureId);
  }

  // ── Cross-referencing / reuse (§14) ──────────────────────────────────────

  @Post(':id/statutory-audit/procedures/:procedureId/areas')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link a procedure to another audit area (§14)' })
  linkArea(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Body() dto: LinkAreaDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.linkArea(
      rlsContextFromPrincipal(principal),
      id,
      procedureId,
      dto.workAreaId,
    );
  }

  @Delete(':id/statutory-audit/procedures/:procedureId/areas/:workAreaId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Unlink a procedure from an audit area (§14)' })
  unlinkArea(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Param('workAreaId', new ParseUUIDPipe()) workAreaId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.unlinkArea(
      rlsContextFromPrincipal(principal),
      id,
      procedureId,
      workAreaId,
    );
  }

  // ── Evidence (§9, §12) ────────────────────────────────────────────────────

  @Post(':id/statutory-audit/procedures/:procedureId/evidence')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add evidence to a procedure (§12)' })
  addEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Body() dto: AddEvidenceDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.addEvidence(rlsContextFromPrincipal(principal), id, procedureId, dto);
  }

  @Post(':id/statutory-audit/procedures/:procedureId/evidence/link')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link existing evidence to a procedure (§9 reuse)' })
  linkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Body() dto: LinkEvidenceDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.linkEvidence(
      rlsContextFromPrincipal(principal),
      id,
      procedureId,
      dto.evidenceId,
    );
  }

  @Delete(':id/statutory-audit/procedures/:procedureId/evidence/:evidenceId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Detach evidence from a procedure (§9)' })
  unlinkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.unlinkEvidence(
      rlsContextFromPrincipal(principal),
      id,
      procedureId,
      evidenceId,
    );
  }

  // ── Exceptions (§12) ──────────────────────────────────────────────────────

  @Post(':id/statutory-audit/procedures/:procedureId/exceptions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise an exception on a procedure (§12)' })
  addException(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('procedureId', new ParseUUIDPipe()) procedureId: string,
    @Body() dto: AddExceptionDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.addException(rlsContextFromPrincipal(principal), id, procedureId, dto);
  }

  @Post(':id/statutory-audit/exceptions/:exceptionId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update an exception (§12)' })
  updateException(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
    @Body() dto: UpdateExceptionDto,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.updateException(
      rlsContextFromPrincipal(principal),
      id,
      exceptionId,
      dto,
    );
  }

  @Delete(':id/statutory-audit/exceptions/:exceptionId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Delete an exception (§12)' })
  removeException(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
  ): Promise<StatutoryAuditProcedures> {
    return this.procedures.deleteException(rlsContextFromPrincipal(principal), id, exceptionId);
  }
}
