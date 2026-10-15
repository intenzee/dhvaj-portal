import { auditFileTarget } from '@/components/statutory-audit/audit-file-nav';

const PANELS = ['acceptance', 'risk', 'controls', 'audit_areas'];

describe('auditFileTarget — what an audit-file link opens', () => {
  it('opens an area inside the audit-areas section', () => {
    expect(auditFileTarget(null, 'a1', PANELS)).toEqual({
      phaseKey: 'audit_areas',
      anchor: 'area-a1',
    });
    // The area wins over a section named alongside it.
    expect(auditFileTarget('risk', 'a1', PANELS)).toEqual({
      phaseKey: 'audit_areas',
      anchor: 'area-a1',
    });
  });

  it('opens a section the file has, and nothing for one it has not', () => {
    expect(auditFileTarget('risk', null, PANELS)).toEqual({ phaseKey: 'risk' });
    expect(auditFileTarget('archiving', null, PANELS)).toBeNull();
    expect(auditFileTarget(null, null, PANELS)).toBeNull();
  });
});
