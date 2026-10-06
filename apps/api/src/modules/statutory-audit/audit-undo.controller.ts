import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AuditUndoResult, type AuditUndoStatus } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditUndoService } from './audit-undo.service';

/**
 * Audit file undo / redo — take back (or put back) the caller's own last
 * click on the file. Only the person who made a change can undo it.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditUndoController {
  constructor(private readonly undo: AuditUndoService) {}

  @Get(':id/statutory-audit/undo')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The caller's next undo and redo on the audit file" })
  status(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AuditUndoStatus> {
    return this.undo.status(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/undo')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "Undo the caller's last change to the audit file" })
  undoLast(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AuditUndoResult> {
    return this.undo.apply(rlsContextFromPrincipal(principal), id, 'undo');
  }

  @Post(':id/statutory-audit/redo')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "Redo the caller's last undone change to the audit file" })
  redoLast(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AuditUndoResult> {
    return this.undo.apply(rlsContextFromPrincipal(principal), id, 'redo');
  }
}
