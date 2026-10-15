import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type FormInternalDueList,
  type FormInternalDueUpdate,
  type WorkflowSettings,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { UpdateFormInternalDueDto, UpdateWorkflowSettingsDto } from './workflow-settings.dto';
import { WorkflowSettingsService } from './workflow-settings.service';

/** Staff Workflow · Questions for the partners (Admin → Workflow). */
@ApiTags('workflow-settings')
@Controller('workflow-settings')
export class WorkflowSettingsController {
  constructor(private readonly settings: WorkflowSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "The firm's workflow policy",
    description:
      'Default reviewer, which clients articles see, how client reminders go, who may ' +
      'bulk-assign, and the client chasing days.',
  })
  get(@CurrentPrincipal() principal: Principal): Promise<WorkflowSettings> {
    return this.settings.get(rlsContextFromPrincipal(principal));
  }

  @Patch()
  @RequirePermissions(PERMISSION.workflowManage)
  @ApiOperation({ summary: "Change the firm's workflow policy (partners; audited)" })
  update(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateWorkflowSettingsDto,
  ): Promise<WorkflowSettings> {
    return this.settings.update(rlsContextFromPrincipal(principal), dto);
  }

  @Get('internal-due')
  @RequirePermissions(PERMISSION.complianceRead)
  @ApiOperation({
    summary: 'Each form’s internal due date: days before the statutory date',
    description: 'The firm’s answer where set, else the rule’s; with the plan’s suggestion.',
  })
  internalDue(@CurrentPrincipal() principal: Principal): Promise<FormInternalDueList> {
    return this.settings.internalDue(rlsContextFromPrincipal(principal));
  }

  @Patch('internal-due/:ruleId')
  @RequirePermissions(PERMISSION.workflowManage)
  @ApiOperation({
    summary: 'Set a form’s internal due date for the firm (partners; audited)',
    description:
      'Every open filing of the form without a manual internal date is re-dated at once, ' +
      'pulled back to a working day; new filings use it too.',
  })
  setInternalDue(
    @CurrentPrincipal() principal: Principal,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateFormInternalDueDto,
  ): Promise<FormInternalDueUpdate> {
    return this.settings.setInternalDue(
      rlsContextFromPrincipal(principal),
      ruleId,
      dto.internalSlaOffsetDays,
    );
  }
}
