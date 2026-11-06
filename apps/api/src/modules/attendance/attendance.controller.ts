import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  monthRange,
  type AttendanceMonth,
  type AttendanceRegister,
  type AttendanceSettings,
  type Holiday,
  type LeaveApprovals,
  type LeaveRequest,
  type MyDay,
  type MyLeave,
  type PickEngagement,
  type PickTask,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AttendanceService, requireMonth } from './attendance.service';
import { LeaveService } from './leave.service';
import {
  AddHolidayDto,
  ApplyLeaveDto,
  AttendanceSettingsDto,
  DayLocationDto,
  DecideLeaveDto,
  HolidaysQueryDto,
  LogInternalDto,
  LogWorkDto,
  PickEngagementsQueryDto,
  PickTasksQueryDto,
  UpdateDayEntryDto,
} from './dto/attendance.dto';

/**
 * Attendance (see packages/contracts/src/attendance.ts). Anyone with an
 * employee record keeps their own; Row Level Security keeps a team's to the
 * people who report to you; the register is HR's and the Managing Partner's.
 */
@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  // ── Your day ────────────────────────────────────────────────────────────

  @Get('day/:day')
  @ApiOperation({ summary: 'Your day: rows, hours and the status they come to' })
  day(@CurrentPrincipal() p: Principal, @Param('day') day: string): Promise<MyDay> {
    return this.attendance.myDay(rlsContextFromPrincipal(p), day);
  }

  @Post('day/:day/work')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log client work: engagement, stream, task, hours, where' })
  logWork(
    @CurrentPrincipal() p: Principal,
    @Param('day') day: string,
    @Body() dto: LogWorkDto,
  ): Promise<MyDay> {
    return this.attendance.logWork(rlsContextFromPrincipal(p), day, dto);
  }

  @Post('day/:day/internal')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log firm work: training, admin, internal meetings…' })
  logInternal(
    @CurrentPrincipal() p: Principal,
    @Param('day') day: string,
    @Body() dto: LogInternalDto,
  ): Promise<MyDay> {
    return this.attendance.logInternal(rlsContextFromPrincipal(p), day, dto);
  }

  @Post('day/:day/location')
  @HttpCode(200)
  @ApiOperation({ summary: '"I worked from …" for the rows of the day not yet placed' })
  dayLocation(
    @CurrentPrincipal() p: Principal,
    @Param('day') day: string,
    @Body() dto: DayLocationDto,
  ): Promise<MyDay> {
    return this.attendance.setDayLocation(rlsContextFromPrincipal(p), day, dto.location);
  }

  @Patch('entries/:id')
  @ApiOperation({ summary: 'Change a row: hours, where, note' })
  updateEntry(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDayEntryDto,
  ): Promise<MyDay> {
    return this.attendance.updateEntry(rlsContextFromPrincipal(p), id, dto);
  }

  @Delete('entries/:id')
  @ApiOperation({ summary: 'Take a logged row out' })
  deleteEntry(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MyDay> {
    return this.attendance.deleteEntry(rlsContextFromPrincipal(p), id);
  }

  @Get('pick/engagements')
  @ApiOperation({ summary: 'The engagements you can log on (yours first; ?q= searches)' })
  pickEngagements(
    @CurrentPrincipal() p: Principal,
    @Query() q: PickEngagementsQueryDto,
  ): Promise<PickEngagement[]> {
    return this.attendance.pickEngagements(rlsContextFromPrincipal(p), q.q);
  }

  @Get('pick/tasks')
  @ApiOperation({ summary: 'The tasks on one engagement (yours first)' })
  pickTasks(@CurrentPrincipal() p: Principal, @Query() q: PickTasksQueryDto): Promise<PickTask[]> {
    return this.attendance.pickTasks(rlsContextFromPrincipal(p), q.engagementId);
  }

  // ── Months ──────────────────────────────────────────────────────────────

  @Get('month/:month')
  @ApiOperation({ summary: 'Your month, day by day' })
  month(@CurrentPrincipal() p: Principal, @Param('month') month: string): Promise<AttendanceMonth> {
    return this.attendance.myMonth(rlsContextFromPrincipal(p), month);
  }

  @Get('team/:month')
  @ApiOperation({ summary: 'Your team’s month: everyone who reports to you' })
  team(
    @CurrentPrincipal() p: Principal,
    @Param('month') month: string,
  ): Promise<AttendanceRegister> {
    return this.attendance.teamMonth(rlsContextFromPrincipal(p), month);
  }

  @Get('people/:id/day/:day')
  @ApiOperation({ summary: 'One of your team’s days (read only)' })
  personDay(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('day') day: string,
  ): Promise<MyDay> {
    return this.attendance.personDay(rlsContextFromPrincipal(p), id, day);
  }

  @Get('register/:month')
  @RequirePermissions(PERMISSION.timeReadAttendance)
  @ApiOperation({ summary: 'The firm’s month (HR, Managing Partner)' })
  register(
    @CurrentPrincipal() p: Principal,
    @Param('month') month: string,
  ): Promise<AttendanceRegister> {
    return this.attendance.register(rlsContextFromPrincipal(p), month);
  }

  @Get('register/:month/export')
  @RequirePermissions(PERMISSION.timeReadAttendance)
  @ApiOperation({ summary: 'The firm’s month as a CSV, for payroll' })
  async registerExport(
    @CurrentPrincipal() p: Principal,
    @Param('month') month: string,
  ): Promise<StreamableFile> {
    const csv = await this.attendance.registerCsv(rlsContextFromPrincipal(p), requireMonth(month));
    return new StreamableFile(Buffer.from(`﻿${csv}`, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="attendance-${month}.csv"`,
    });
  }

  @Get('register/:month/leave')
  @RequirePermissions(PERMISSION.timeReadAttendance)
  @ApiOperation({ summary: 'The firm’s leave requests touching a month' })
  registerLeave(
    @CurrentPrincipal() p: Principal,
    @Param('month') month: string,
  ): Promise<LeaveRequest[]> {
    const { from, to } = monthRange(requireMonth(month));
    return this.leave.firmLeave(rlsContextFromPrincipal(p), from, to);
  }

  // ── Leave ───────────────────────────────────────────────────────────────

  @Get('leave')
  @ApiOperation({ summary: 'Your leave: the year’s balances and your requests' })
  myLeave(@CurrentPrincipal() p: Principal, @Query() q: HolidaysQueryDto): Promise<MyLeave> {
    return this.leave.myLeave(rlsContextFromPrincipal(p), q.year);
  }

  @Post('leave')
  @ApiOperation({ summary: 'Ask for leave' })
  applyLeave(@CurrentPrincipal() p: Principal, @Body() dto: ApplyLeaveDto): Promise<LeaveRequest> {
    return this.leave.apply(rlsContextFromPrincipal(p), dto);
  }

  @Get('leave/approvals')
  @ApiOperation({ summary: 'Leave waiting for you, and lately decided' })
  approvals(@CurrentPrincipal() p: Principal): Promise<LeaveApprovals> {
    return this.leave.approvals(rlsContextFromPrincipal(p));
  }

  @Post('leave/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw your request' })
  cancelLeave(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeaveRequest> {
    return this.leave.cancel(rlsContextFromPrincipal(p), id);
  }

  @Post('leave/:id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject a request' })
  decideLeave(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
  ): Promise<LeaveRequest> {
    return this.leave.decide(rlsContextFromPrincipal(p), id, dto);
  }

  // ── Holidays and settings ───────────────────────────────────────────────

  @Get('holidays')
  @ApiOperation({ summary: 'The firm’s holidays in a year' })
  holidays(@CurrentPrincipal() p: Principal, @Query() q: HolidaysQueryDto): Promise<Holiday[]> {
    return this.leave.holidays(rlsContextFromPrincipal(p), q.year);
  }

  @Post('holidays')
  @ApiOperation({ summary: 'Add a holiday (HR, Managing Partner, administrator)' })
  addHoliday(@CurrentPrincipal() p: Principal, @Body() dto: AddHolidayDto): Promise<Holiday> {
    return this.leave.addHoliday(rlsContextFromPrincipal(p), dto);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Take a holiday off the list' })
  removeHoliday(
    @CurrentPrincipal() p: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.leave.removeHoliday(rlsContextFromPrincipal(p), id);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Full day, half day, leave a year' })
  settings(@CurrentPrincipal() p: Principal): Promise<AttendanceSettings> {
    return this.leave.settings(rlsContextFromPrincipal(p));
  }

  @Put('settings')
  @ApiOperation({ summary: 'Change them (HR, Managing Partner)' })
  updateSettings(
    @CurrentPrincipal() p: Principal,
    @Body() dto: AttendanceSettingsDto,
  ): Promise<AttendanceSettings> {
    // A type left out keeps what it was (the service reads undefined as unchanged).
    return this.leave.updateSettings(rlsContextFromPrincipal(p), {
      ...dto,
      allowances: dto.allowances as AttendanceSettings['allowances'],
    });
  }
}
