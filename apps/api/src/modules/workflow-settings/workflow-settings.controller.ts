import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type FormInternalDueList,
  type FormInternalDueUpdate,
  type WorkflowSettings,
} from '@hsdg/contracts';
import {
  CurrentPrincipal,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  UpdateFirmChecksDto,
  UpdateFormInternalDueDto,
  UpdateWorkflowSettingsDto,
} from './workflow-settings.dto';
import { WorkflowSettingsService } from './workflow-settings.service';

/** Staff Workflow · Questions for the partners (Admin → Workflow). */
@ApiTags('workflow-settings')
@Controller('workflow-settings')
export class WorkflowSettingsController {
  constructor(private readonly settings: WorkflowSettingsService) {}

  // Staff, and the administrator, who switches the firm's checks.
  @Get()
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.userManage)
  @ApiOperation({
    summary: "The firm's workflow policy",
    description:
      'Default reviewer, which clients articles see, how client reminders go, who may ' +
      "bulk-assign, the client chasing days, and the firm's checks.",
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

  @Patch('checks')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.userManage)
  @ApiOperation({
    summary: "Switch the firm's checks on or off (managing partner or administrator; audited)",
    description:
      'Each check is a rule the portal enforces while it is on; while it is off the work ' +
      'goes ahead with a warning. All start off.',
  })
  updateChecks(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateFirmChecksDto,
  ): Promise<WorkflowSettings> {
    return this.settings.updateChecks(rlsContextFromPrincipal(principal), dto);
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
