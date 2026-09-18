import {
  countOpenReassessments,
  reassessmentImpact,
  reassessmentReopensPlanning,
  REASSESSMENT_CHANGE_TYPE,
  REASSESSMENT_CHANGE_LABEL,
  REASSESSMENT_STATUS,
  type ReassessmentChangeType,
} from '@hsdg/contracts';

const ALL = Object.values(REASSESSMENT_CHANGE_TYPE);

describe('reassessmentImpact (§30)', () => {
  it('maps every change type to an explicit impact (no silent no-op)', () => {
    for (const t of ALL) {
      const impact = reassessmentImpact(t);
      const touchesSomething =
        impact.framework || impact.planning || impact.risk || impact.work || impact.reporting;
      expect(touchesSomething).toBe(true);
    }
  });

  it('applies the §30 rules', () => {
    expect(reassessmentImpact('materiality_revised')).toMatchObject({ planning: true, work: true });
    expect(reassessmentImpact('risk_changed')).toMatchObject({ risk: true, work: true });
    expect(reassessmentImpact('new_subsidiary')).toMatchObject({ framework: true, work: true });
    expect(reassessmentImpact('caro_ifc_applicability')).toMatchObject({
      framework: true,
      work: true,
      reporting: true,
    });
    expect(reassessmentImpact('framework_rule_version_changed')).toMatchObject({
      framework: true,
      work: true,
    });
  });

  it('reporting_date_changed touches reporting only (preserve original milestones)', () => {
    expect(reassessmentImpact('reporting_date_changed')).toEqual({
      framework: false,
      planning: false,
      risk: false,
      work: false,
      reporting: true,
    });
  });
});

describe('reassessmentReopensPlanning (§30)', () => {
  it('is true only for planning-affecting change types', () => {
    expect(reassessmentReopensPlanning('materiality_revised')).toBe(true);
    expect(reassessmentReopensPlanning('audit_approach_changed')).toBe(true);
    expect(reassessmentReopensPlanning('risk_changed')).toBe(false);
    expect(reassessmentReopensPlanning('reporting_date_changed')).toBe(false);
  });
});

describe('reassessment vocabulary', () => {
  it('has a human label for every change type', () => {
    for (const t of ALL) {
      expect(REASSESSMENT_CHANGE_LABEL[t as ReassessmentChangeType]).toBeTruthy();
    }
  });
});

describe('countOpenReassessments (§30)', () => {
  it('counts only open events', () => {
    const events = [
      { status: REASSESSMENT_STATUS.open },
      { status: REASSESSMENT_STATUS.open },
      { status: REASSESSMENT_STATUS.resolved },
    ];
    expect(countOpenReassessments(events)).toBe(2);
    expect(countOpenReassessments([])).toBe(0);
  });
});
