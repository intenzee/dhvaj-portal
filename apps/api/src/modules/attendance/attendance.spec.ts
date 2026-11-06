import {
  attendanceStatus,
  formatWorked,
  leaveDayCount,
  parseHoursInput,
  summarise,
  type AttendanceRegister,
  type DayAttendance,
} from '@hsdg/contracts';
import { buildDays, csvCell, inEditWindow, istDay, loggedWindow } from './attendance-days';
import { registerCsv } from './attendance.service';
import { leavesClash, leaveSpan } from './leave.service';

// 2026-11-06 is a Friday; 2026-11-08 a Sunday.
const base = {
  today: '2026-11-06',
  workedSeconds: 0,
  leave: null,
  holiday: false,
  presentMinutes: 480,
  halfDayMinutes: 240,
};
const H = 3600;

describe('attendanceStatus', () => {
  it('8h is Present, 4h a Half day, less Absent once the day is over', () => {
    expect(attendanceStatus({ ...base, day: '2026-11-05', workedSeconds: 8 * H })).toBe('present');
    expect(attendanceStatus({ ...base, day: '2026-11-05', workedSeconds: 5 * H })).toBe('half_day');
    expect(attendanceStatus({ ...base, day: '2026-11-05', workedSeconds: 3 * H })).toBe('absent');
  });

  it('today stays open until it reaches the full day', () => {
    expect(attendanceStatus({ ...base, day: '2026-11-06', workedSeconds: 3 * H })).toBe('open');
    expect(attendanceStatus({ ...base, day: '2026-11-06', workedSeconds: 8 * H })).toBe('present');
  });

  it('Sunday is the weekly off, Saturday works, a holiday is a holiday', () => {
    expect(attendanceStatus({ ...base, day: '2026-11-01' })).toBe('weekly_off');
    expect(attendanceStatus({ ...base, day: '2026-10-31' })).toBe('absent');
    expect(attendanceStatus({ ...base, day: '2026-11-04', holiday: true })).toBe('holiday');
  });

  it('half a day of leave and 4h of work is Present', () => {
    const leave = { half: 'first_half' as const };
    expect(attendanceStatus({ ...base, day: '2026-11-05', leave, workedSeconds: 4 * H })).toBe(
      'present',
    );
    expect(attendanceStatus({ ...base, day: '2026-11-05', leave, workedSeconds: 1 * H })).toBe(
      'half_day',
    );
    expect(attendanceStatus({ ...base, day: '2026-11-05', leave: { half: null } })).toBe('leave');
  });

  it('days to come, and days out of employment', () => {
    expect(attendanceStatus({ ...base, day: '2026-11-10' })).toBe('upcoming');
    expect(attendanceStatus({ ...base, day: '2026-11-10', leave: { half: null } })).toBe('leave');
    expect(attendanceStatus({ ...base, day: '2026-11-05', employed: false })).toBe('none');
  });
});

describe('summarise', () => {
  const day = (over: Partial<DayAttendance>): DayAttendance => ({
    day: '2026-11-05',
    status: 'present',
    workedSeconds: 0,
    byLocation: {},
    leave: null,
    holidayName: null,
    ...over,
  });

  it('counts payable days: paid leave paid, unpaid not', () => {
    const s = summarise([
      day({ status: 'present', workedSeconds: 8 * H, byLocation: { home: 8 * H } }),
      day({ status: 'half_day', workedSeconds: 5 * H, byLocation: { office: 5 * H } }),
      day({ status: 'absent' }),
      day({ status: 'leave', leave: { id: 'l', type: 'casual', half: null, status: 'approved' } }),
      day({ status: 'leave', leave: { id: 'u', type: 'unpaid', half: null, status: 'approved' } }),
      day({ status: 'weekly_off' }),
      day({ status: 'holiday' }),
    ]);
    expect(s).toMatchObject({ present: 1, halfDays: 1, absent: 1, holidays: 1, weeklyOffs: 1 });
    expect(s.leave).toEqual({ casual: 1, unpaid: 1 });
    expect(s.payableDays).toBe(1 + 0.5 + 0 + 1 + 0 + 1 + 1);
    expect(s.byLocation).toEqual({ home: 8 * H, office: 5 * H });
  });

  it('a half day of paid leave pays its half', () => {
    const leave = {
      id: 'l',
      type: 'sick' as const,
      half: 'second_half' as const,
      status: 'approved' as const,
    };
    expect(summarise([day({ status: 'present', leave })]).payableDays).toBe(1);
    expect(summarise([day({ status: 'half_day', leave })]).payableDays).toBe(0.5);
    const unpaid = { ...leave, type: 'unpaid' as const };
    expect(summarise([day({ status: 'present', leave: unpaid })]).payableDays).toBe(0.5);
  });
});

describe('leave and hours helpers', () => {
  it('leave skips Sundays and holidays; a half day is 0.5', () => {
    expect(leaveDayCount('2026-11-06', '2026-11-09', null)).toBe(3);
    expect(leaveDayCount('2026-11-06', '2026-11-09', null, new Set(['2026-11-09']))).toBe(2);
    expect(leaveDayCount('2026-11-06', '2026-11-06', 'first_half')).toBe(0.5);
    expect(leaveDayCount('2026-11-08', '2026-11-08', null)).toBe(0);
  });

  it('two halves of one day do not clash; anything else that meets does', () => {
    const d = { from: '2026-11-10', to: '2026-11-10' };
    expect(leavesClash({ ...d, half: 'first_half' }, { ...d, half: 'second_half' })).toBe(false);
    expect(leavesClash({ ...d, half: 'first_half' }, { ...d, half: 'first_half' })).toBe(true);
    expect(
      leavesClash({ ...d, half: null }, { from: '2026-11-09', to: '2026-11-12', half: null }),
    ).toBe(true);
    expect(
      leavesClash({ ...d, half: null }, { from: '2026-11-11', to: '2026-11-12', half: null }),
    ).toBe(false);
    expect(leaveSpan('2026-11-10', '2026-11-12', null)).toBe('10 Nov – 12 Nov 2026');
  });

  it('reads hours as people type them', () => {
    expect(parseHoursInput('2')).toBe(120);
    expect(parseHoursInput('1.5')).toBe(90);
    expect(parseHoursInput('1:30')).toBe(90);
    expect(parseHoursInput('1h 30m')).toBe(90);
    expect(parseHoursInput('90m')).toBe(90);
    expect(parseHoursInput('two')).toBeNull();
    expect(formatWorked(2.5 * H)).toBe('2h 30m');
  });
});

describe('attendance-days', () => {
  const now = new Date('2026-11-06T05:00:00Z'); // 10:30 IST

  it('the edit window is today and the last 3 days', () => {
    expect(istDay(now)).toBe('2026-11-06');
    expect(inEditWindow('2026-11-06', now)).toBe(true);
    expect(inEditWindow('2026-11-03', now)).toBe(true);
    expect(inEditWindow('2026-11-02', now)).toBe(false);
    expect(inEditWindow('2026-11-07', now)).toBe(false);
  });

  it('a logged row starts at 9 am, earlier today when it would not fit by now', () => {
    expect(loggedWindow('2026-11-05', 120, now).startedAt.toISOString()).toBe(
      '2026-11-05T03:30:00.000Z',
    );
    // 10:30 IST − 5h = 05:30 IST: still today.
    expect(loggedWindow('2026-11-06', 300, now).startedAt.toISOString()).toBe(
      '2026-11-06T00:00:00.000Z',
    );
    // 12h by 10:30 IST would start yesterday: held to just after midnight.
    expect(loggedWindow('2026-11-06', 720, now).startedAt.toISOString()).toBe(
      '2026-11-05T18:31:00.000Z',
    );
  });

  it('builds the days with hours by place, leave and holidays', () => {
    const days = buildDays({
      from: '2026-11-02',
      to: '2026-11-08',
      today: '2026-11-06',
      hours: [
        { employee_id: 'e', day: '2026-11-02', work_location: 'office', seconds: 5 * H },
        { employee_id: 'e', day: '2026-11-02', work_location: null, seconds: 3 * H },
      ],
      leaves: [
        {
          id: 'l',
          employee_id: 'e',
          leave_type: 'casual',
          from_day: '2026-11-03',
          to_day: '2026-11-03',
          half: null,
          status: 'approved',
        },
      ],
      holidays: new Map([['2026-11-04', 'Founders day']]),
      employment: { joined: '2026-01-01', exited: null },
      presentMinutes: 480,
      halfDayMinutes: 240,
    });
    expect(days.map((d) => d.status)).toEqual([
      'present',
      'leave',
      'holiday',
      'absent',
      'open',
      'upcoming',
      'weekly_off',
    ]);
    expect(days[0]!.byLocation).toEqual({ office: 5 * H, unset: 3 * H });
  });

  it('a CSV cell never runs as a formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('A, "B"')).toBe('"A, ""B"""');
    expect(csvCell(null)).toBe('');
  });

  it('the register CSV has a column a day and the totals', () => {
    const reg: AttendanceRegister = {
      month: '2026-11',
      holidays: [],
      people: [
        {
          employeeId: 'e',
          employeeCode: 'EMP006',
          employeeName: 'Senior Y',
          officeCode: 'SOUTH',
          gradeName: null,
          days: [
            {
              day: '2026-11-01',
              status: 'weekly_off',
              workedSeconds: 0,
              byLocation: {},
              leave: null,
              holidayName: null,
            },
            {
              day: '2026-11-02',
              status: 'present',
              workedSeconds: 8 * H,
              byLocation: { home: 8 * H },
              leave: null,
              holidayName: null,
            },
          ],
          summary: summarise([]),
        },
      ],
    };
    const [title, head, row] = registerCsv(reg).split('\r\n');
    expect(title).toBe('Attendance 2026-11-01 to 2026-11-30');
    expect(head!.startsWith('Code,Name,Office,Grade,01,02,Present')).toBe(true);
    expect(row!.startsWith('EMP006,Senior Y,SOUTH,,WO,P,')).toBe(true);
  });
});
