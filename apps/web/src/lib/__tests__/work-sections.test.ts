import {
  isStreamSection,
  parseWorkSections,
  STREAM_SECTIONS,
  WORK_SECTION_LABEL,
  workSectionsParam,
} from '@hsdg/contracts';
import { toggleSection, withSections } from '@/components/section-filter';
import { calendarLink, dayMarks, monthRange } from '@/components/dashboard/compliance-mini-calendar';
import { upcomingPath } from '@/components/dashboard/upcoming-deadlines';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

describe('work sections', () => {
  it('parses a comma list in canonical order, dropping unknown and repeated keys', () => {
    expect(parseWorkSections('income_tax,gst,bogus,gst')).toEqual(['gst', 'income_tax']);
    expect(parseWorkSections(['roc', 'statutory_audit,assignment'])).toEqual([
      'roc',
      'statutory_audit',
      'assignment',
    ]);
    expect(parseWorkSections(null)).toEqual([]);
    expect(parseWorkSections('')).toEqual([]);
  });

  it('writes the param in canonical order and empty for "all"', () => {
    expect(workSectionsParam(['income_tax', 'gst'])).toBe('gst,income_tax');
    expect(workSectionsParam([])).toBe('');
  });

  it('knows which sections are filing streams', () => {
    expect(STREAM_SECTIONS).toEqual(['gst', 'tds', 'income_tax', 'roc', 'bookkeeping', 'mis']);
    expect(isStreamSection('gst')).toBe(true);
    expect(isStreamSection('statutory_audit')).toBe(false);
    expect(WORK_SECTION_LABEL.income_tax).toBe('Income Tax');
    expect(WORK_SECTION_LABEL.assignment).toBe('Assignments');
  });

  it('toggles a chip in and out, keeping canonical order', () => {
    expect(toggleSection([], 'income_tax')).toEqual(['income_tax']);
    expect(toggleSection(['income_tax'], 'gst')).toEqual(['gst', 'income_tax']);
    expect(toggleSection(['gst', 'income_tax'], 'gst')).toEqual(['income_tax']);
  });

  it('appends the section to a path', () => {
    expect(withSections('/work/tasks?limit=6', ['gst', 'roc'])).toBe(
      '/work/tasks?limit=6&section=gst,roc',
    );
    expect(withSections('/tasks', ['statutory_audit'])).toBe('/tasks?section=statutory_audit');
    expect(withSections('/tasks', [])).toBe('/tasks');
  });
});

describe('home calendar by section', () => {
  const row = (dueDate: string, workflowStatus: string, daysLeft: number) =>
    ({ dueDate, workflowStatus, daysLeft }) as never;

  it('spans the whole month, leap years included', () => {
    expect(monthRange(2026, 9)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange(2028, 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('marks each day with its worst filing: overdue > due > filed', () => {
    const marks = dayMarks(
      [
        row('2026-10-07', 'filed', -7),
        row('2026-10-07', 'in_preparation', -7),
        row('2026-10-11', 'not_started', 0),
        row('2026-10-11', 'filed', 0),
        row('2026-10-20', 'not_applicable', 6),
        row('2026-11-20', 'not_started', 37),
      ],
      '2026-10',
    );
    expect([...marks.entries()]).toEqual([
      [7, 'overdue'],
      [11, 'due'],
      [20, 'filed'],
    ]);
  });

  it('links to the firm calendar on the same month and section', () => {
    expect(calendarLink(['gst'], 2026, 9)).toBe('/compliance?stream=gst&month=2026-10');
    expect(calendarLink([], 2027, 0)).toBe('/compliance?month=2027-01');
  });

  it('asks Upcoming Deadlines for open filings over the next 90 days in the section', () => {
    expect(upcomingPath(new Date(2026, 9, 14), ['income_tax'])).toBe(
      '/compliance/calendar?from=2026-10-14&to=2027-01-12' +
        '&status=not_started,awaiting_data,in_preparation,in_review,ready_to_file&stream=income_tax',
    );
    expect(upcomingPath(new Date(2026, 9, 14), [])).not.toContain('stream=');
  });
});
