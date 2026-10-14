import {
  isStreamSection,
  parseWorkSections,
  STREAM_SECTIONS,
  WORK_SECTION_LABEL,
  workSectionsParam,
} from '@hsdg/contracts';
import { toggleSection } from '@/components/section-filter';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
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
});
