import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type DeletePersonCheck,
  type DeletePersonResult,
  type MoveWorkResult,
  type PeopleRoster,
  type StartExitResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PeopleAdminService } from './people-admin.service';
import { DeactivateDto, DeletePersonDto, MoveWorkDto } from './dto/people-admin.dto';

/**
 * The People screen (B-2) and leaving the firm (B-3). user.manage gets you in
 * (the Managing Partner and the administrator); the service checks the rest,
 * and deleting permanently is the administrator's alone.
 */
@ApiTags('people')
@Controller('people')
export class PeopleAdminController {
  constructor(private readonly admin: PeopleAdminService) {}

  @Get('admin/roster')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Everyone in one table, with the day-one clean-up list',
    description:
      'Grade, main role, add-ons, reporting line, office, status and open-task count per person; the clean-up list is worked out from the data. Managing Partner and administrator.',
  })
  roster(@CurrentPrincipal() principal: Principal): Promise<PeopleRoster> {
    return this.admin.roster(rlsContextFromPrincipal(principal));
  }

  @Post('admin/move-work')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Move all of one person’s open work to another (audited)',
    description:
      'Open tasks they do or review go to the new person, who joins those engagements’ teams. Each move is kept in the task’s assignment history with the reason.',
  })
  moveWork(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: MoveWorkDto,
  ): Promise<MoveWorkResult> {
    return this.admin.moveWork(rlsContextFromPrincipal(principal), dto);
  }

  @Post('employees/:id/deactivate')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Deactivate someone: login off, exit date set (audited)',
    description: '409 while they still have open tasks — move their work first.',
  })
  deactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DeactivateDto,
  ): Promise<StartExitResult> {
    return this.admin.deactivate(rlsContextFromPrincipal(principal), id, dto);
  }

  @Get('employees/:id/delete-check')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'What stands in the way of deleting someone permanently',
    description:
      'Open tasks, engagements they lead, unpaid pay; and whether past work names them. Administrator only.',
  })
  deleteCheck(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DeletePersonCheck> {
    return this.admin.deleteCheck(rlsContextFromPrincipal(principal), id);
  }

  @Delete('employees/:id')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Delete someone permanently (administrator only, audited)',
    description:
      'With no work history the record and login go. Otherwise the login and personal data (bank, PAN, salary, tax, HR documents) go and the record stays as "Name (former employee)". Type their name to confirm.',
  })
  deletePerson(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DeletePersonDto,
  ): Promise<DeletePersonResult> {
    return this.admin.deletePerson(rlsContextFromPrincipal(principal), id, dto);
  }
}
