import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AttendanceReport,
  type EmployeeHistoryEvent,
  type MonthlyHoursReport,
  type PeopleDesk,
  type PeopleWorkloadReport,
  type StartExitResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { onboardCeiling } from '../identity/onboard-ceiling';
import { PeopleService, type LoginPower } from './people.service';
import { AttendanceQueryDto, MonthlyHoursQueryDto, WorkloadQueryDto } from './dto/people-query.dto';
import { StartExitDto } from './dto/start-exit.dto';

/**
 * The People desk (HR, spec §4). Figures about people only: hours by kind and
 * engagement counts, never a client, engagement or task name. The database
 * functions behind these refuse anyone but HR and the Managing Partner.
 */
@ApiTags('people')
@Controller()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get('people/desk')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'People desk: headcount, needs-action queues, workload counts' })
  desk(@CurrentPrincipal() principal: Principal): Promise<PeopleDesk> {
    return this.people.desk(rlsContextFromPrincipal(principal));
  }

  @Get('people/attendance')
  @RequirePermissions(PERMISSION.timeReadAttendance)
  @ApiOperation({
    summary: 'Daily attendance per person (first start, last stop, hours by kind)',
    description: 'No engagement, client or note. At most 93 days per call.',
  })
  attendance(
    @CurrentPrincipal() principal: Principal,
    @Query() q: AttendanceQueryDto,
  ): Promise<AttendanceReport> {
    return this.people.attendance(rlsContextFromPrincipal(principal), q.from, q.to);
  }

  @Get('me/attendance')
  @ApiOperation({ summary: 'Your own daily attendance (anyone signed in)' })
  myAttendance(
    @CurrentPrincipal() principal: Principal,
    @Query() q: AttendanceQueryDto,
  ): Promise<AttendanceReport> {
    return this.people.myAttendance(rlsContextFromPrincipal(principal), q.from, q.to);
  }

  @Get('people/workload')
  @RequirePermissions(PERMISSION.reportReadPeople)
  @ApiOperation({
    summary: 'Workload per person as counts (engagements, tasks, hours this week)',
    description: 'Resource Management without client or engagement names.',
  })
  workload(
    @CurrentPrincipal() principal: Principal,
    @Query() q: WorkloadQueryDto,
  ): Promise<PeopleWorkloadReport> {
    return this.people.workload(rlsContextFromPrincipal(principal), q.week);
  }

  @Get('people/reports/hours')
  @RequirePermissions(PERMISSION.reportReadPeople)
  @ApiOperation({ summary: 'A month’s hours per person, by kind (for export)' })
  monthlyHours(
    @CurrentPrincipal() principal: Principal,
    @Query() q: MonthlyHoursQueryDto,
  ): Promise<MonthlyHoursReport> {
    return this.people.monthlyHours(rlsContextFromPrincipal(principal), q.month);
  }

  @Post('people/employees/:id/exit')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({
    summary: 'Start an exit (audited)',
    description:
      'Sets the date of exit. On that date the person is exited and their login switched off with its password removed (today or past: now). Partners whose work they are on are asked to reassign it.',
  })
  startExit(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StartExitDto,
  ): Promise<StartExitResult> {
    return this.people.startExit(
      rlsContextFromPrincipal(principal),
      id,
      dto,
      loginPower(principal),
    );
  }

  @Get('people/employees/:id/history')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({
    summary: 'The change history of one employee record',
    description:
      'Audit events about this person only: their record, articleship, HR documents, exit and login. HR and the Managing Partner (the firm-wide audit log stays with the MP and the Administrator).',
  })
  history(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EmployeeHistoryEvent[]> {
    return this.people.history(rlsContextFromPrincipal(principal), id);
  }
}

/** What the caller may do to a leaver's login (spec §7.5). */
function loginPower(principal: Principal): LoginPower {
  if (principal.permissions.includes(PERMISSION.userManage)) return 'all';
  if (principal.permissions.includes(PERMISSION.userOnboard)) return onboardCeiling(principal)!;
  return null;
}
