/**
 * Pure helpers for the People desk: IST dates and the "Needs action" queues.
 * No database here, so the rules are unit-tested on their own.
 */
import {
  ARTICLES_COMPLETING_DAYS,
  GRADE,
  PEOPLE_DESK_QUEUE,
  TEMPORARY_PASSWORD_STALE_DAYS,
  type EmploymentStatus,
  type GradeSlug,
  type PeopleDeskPerson,
  type PeopleDeskQueueItem,
} from '@hsdg/contracts';

const DAY_MS = 86_400_000;

/** YYYY-MM-DD plus n days (UTC arithmetic on a calendar date). */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week holding `date`. */
export function weekStartOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The day before `today`, skipping Sunday (the firm works Saturdays). */
export function lastWorkingDay(today: string): string {
  const y = addDays(today, -1);
  return new Date(`${y}T00:00:00Z`).getUTCDay() === 0 ? addDays(y, -1) : y;
}

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/** "12 Oct 2026". */
export function shortDate(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** One employee as the desk sees them. */
export interface DeskEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
  officeCode: string;
  gradeSlug: GradeSlug;
  gradeName: string;
  employmentStatus: EmploymentStatus;
  dateOfJoining: string;
  dateOfExit: string | null;
  userId: string | null;
  /** Null when there is no login (or it can't be seen). */
  userActive: boolean | null;
  /** From the articleship register, articles only. */
  articleshipCompletes: string | null;
}

export interface LoginFlag {
  mustChange: boolean;
  /** When the current password was set (ISO). */
  setAt: string;
  locked: boolean;
}

export interface DeskInputs {
  today: string;
  /** Exact current time, for the temporary-password age. */
  now: Date;
  employees: DeskEmployee[];
  flags: Map<string, LoginFlag>;
  /** Employees with any time on the last working day. */
  loggedOnLastWorkingDay: Set<string>;
}

const person = (e: DeskEmployee, detail: string | null): PeopleDeskPerson => ({
  employeeId: e.id,
  employeeCode: e.employeeCode,
  employeeName: e.fullName,
  officeCode: e.officeCode,
  gradeName: e.gradeName,
  detail,
});

/**
 * The six queues, in the order the desk shows them. Exited people only count
 * for "exit passed, login still on"; partners aren't chased for hours.
 */
export function buildQueues(input: DeskInputs): PeopleDeskQueueItem[] {
  const { today, now, employees, flags, loggedOnLastWorkingDay } = input;
  const staleBefore = now.getTime() - TEMPORARY_PASSWORD_STALE_DAYS * DAY_MS;
  const completingBy = addDays(today, ARTICLES_COMPLETING_DAYS);
  const lastDay = lastWorkingDay(today);

  const current = employees.filter((e) => e.employmentStatus !== 'exited');
  const q = (key: PeopleDeskQueueItem['key'], people: PeopleDeskPerson[]): PeopleDeskQueueItem => ({
    key,
    count: people.length,
    people,
  });

  const noLogin = current.filter((e) => !e.userId).map((e) => person(e, null));

  const locked: PeopleDeskPerson[] = [];
  const temporary: PeopleDeskPerson[] = [];
  for (const e of current) {
    if (!e.userId || e.userActive === false) continue;
    const f = flags.get(e.userId);
    if (!f) continue;
    if (f.locked) locked.push(person(e, 'Locked after wrong passwords'));
    if (f.mustChange && Date.parse(f.setAt) < staleBefore) {
      temporary.push(person(e, `Temporary since ${shortDate(f.setAt)}`));
    }
  }

  const completing = current
    .filter(
      (e) =>
        e.articleshipCompletes !== null &&
        e.articleshipCompletes >= today &&
        e.articleshipCompletes <= completingBy,
    )
    .sort((a, b) => a.articleshipCompletes!.localeCompare(b.articleshipCompletes!))
    .map((e) => person(e, `Completes ${shortDate(e.articleshipCompletes!)}`));

  const exitPassed = employees
    .filter((e) => e.dateOfExit !== null && e.dateOfExit < today && e.userActive === true)
    .map((e) => person(e, `Left ${shortDate(e.dateOfExit!)}`));

  const noHours = current
    .filter(
      (e) =>
        e.gradeSlug !== GRADE.partner &&
        e.employmentStatus !== 'on_leave' &&
        e.dateOfJoining <= lastDay &&
        !loggedOnLastWorkingDay.has(e.id),
    )
    .map((e) => person(e, `No time on ${shortDate(lastDay)}`));

  return [
    q(PEOPLE_DESK_QUEUE.noLogin, noLogin),
    q(PEOPLE_DESK_QUEUE.locked, locked),
    q(PEOPLE_DESK_QUEUE.temporaryPassword, temporary),
    q(PEOPLE_DESK_QUEUE.articlesCompleting, completing),
    q(PEOPLE_DESK_QUEUE.exitPassedLoginOn, exitPassed),
    q(PEOPLE_DESK_QUEUE.noHoursYesterday, noHours),
  ];
}
