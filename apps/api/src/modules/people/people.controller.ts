import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AttendanceReport,
  type MonthlyHoursReport,
  type PeopleDesk,
  type PeopleWorkloadReport,
  type StartExitResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PeopleService } from './people.service';
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
    return this.people.startExit(rlsContextFromPrincipal(principal), id, dto);
  }
}
