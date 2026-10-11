import type {
  AreaOfFocusRecord,
  PlanningIntelligenceRecord,
  PlanningSignalRecord,
} from '@hsdg/contracts';
import {
  characteristicsLine,
  composeStrategySummary,
  reportingScopeLine,
} from './audit-planning-intelligence.service';

describe('composeStrategySummary (03.1 §17)', () => {
  const record = (over: Partial<PlanningIntelligenceRecord> = {}): PlanningIntelligenceRecord => ({
    id: 'r',
    workflowInstanceId: 'w',
    engagementId: 'e',
    status: 'manager_assessment',
    orientation: null,
    orientationNote: null,
    additionalScopeRequired: null,
    additionalScope: null,
    priorYearReviewed: false,
    strategySummary: null,
    intelligenceGeneratedAt: null,
    intelligenceReviewedAt: null,
    intelligenceReviewedByName: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...over,
  });
  const signal = (over: Partial<PlanningSignalRecord> = {}): PlanningSignalRecord => ({
    id: 's',
    workflowInstanceId: 'w',
    engagementId: 'e',
    signalCode: 'PS-001',
    source: 'section_02',
    ruleKey: 'initial_audit',
    sourceRef: null,
    sourceLink: null,
    observation: 'This is the first statutory audit of the entity by the firm.',
    whyMayMatter: null,
    potentialImplications: null,
    suggestedAttention: 'enhanced',
    attention: 'enhanced',
    attentionRationale: null,
    managerAssessment: null,
    assessmentRationale: null,
    ownerName: null,
    destinations: [],
    status: 'open',
    isAuto: true,
    ruleCode: 'PSR-001',
    ruleVersion: 1,
    guidanceAnchors: [],
    sourceSection: '02.1',
    sourceChangedAt: null,
    sourceChangeAcknowledgedAt: null,
    documentId: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...over,
  });
  const focus = (over: Partial<AreaOfFocusRecord> = {}): AreaOfFocusRecord => ({
    id: 'f',
    workflowInstanceId: 'w',
    engagementId: 'e',
    focusCode: 'FA-001',
    name: 'Revenue & Receivables',
    whyRequiresAttention: 'Receivables grew faster than revenue.',
    potentialFsAreas: [],
    potentialAssertions: [],
    expectedStrategicImplication: null,
    partnerAttention: false,
    destinations: [],
    status: 'established',
    signalIds: [],
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  it('reports focus areas, orientation (labelled preliminary) and Enhanced signals', () => {
    const text = composeStrategySummary(record({ orientation: 'combined' }), [signal()], [focus()]);
    expect(text).toContain('FA-001 Revenue & Receivables — Receivables grew faster than revenue.');
    expect(text).toContain('Combined controls and substantive (preliminary;');
    expect(text).toContain('PS-001 This is the first statutory audit');
  });

  it('flags a missing AS-01 and says no Partner matters when none exist', () => {
    const text = composeStrategySummary(record(), [], []);
    expect(text).toContain('Not yet recorded (AS-01).');
    expect(text).toContain('No Areas of Focus established yet.');
    expect(text).toContain('None identified.');
  });

  it('lists Immediate Partner Attention signals and partner focus areas; skips closed signals', () => {
    const text = composeStrategySummary(
      record(),
      [
        signal({
          signalCode: 'PS-002',
          attention: 'immediate_partner',
          observation: 'Suspected fraud.',
        }),
        signal({
          signalCode: 'PS-003',
          attention: 'immediate_partner',
          status: 'closed',
          observation: 'Closed one.',
        }),
      ],
      [focus({ focusCode: 'FA-002', name: 'Going concern', partnerAttention: true })],
    );
    expect(text).toContain('PS-002 Suspected fraud.');
    expect(text).toContain('FA-002 Going concern');
    expect(text).not.toContain('Closed one.');
  });

  it('adds §17 timing/resource, AS-02 and prior-year/acceptance sections from structured data', () => {
    const base = {
      workflowInstanceId: 'w',
      engagementId: 'e',
      version: 1,
      createdAt: '',
      updatedAt: '',
    };
    const text = composeStrategySummary(
      record({ additionalScopeRequired: false }),
      [signal({ signalCode: 'PS-004', ruleKey: 'cfs_required', observation: 'CFS required.' })],
      [],
      {
        considerations: [
          {
            ...base,
            id: 'c1',
            kind: 'timing',
            considerationKey: 'component_reporting_dependency',
            label: 'Component reporting dependency',
            basis: null,
            signalId: 's',
            signalCode: 'PS-004',
            signalAttention: 'enhanced',
            isAuto: true,
            assessment: 'relevant',
            rationale: null,
          },
          {
            ...base,
            id: 'c2',
            kind: 'resource',
            considerationKey: 'tax_expertise',
            label: 'Tax expertise',
            basis: null,
            signalId: null,
            signalCode: null,
            signalAttention: null,
            isAuto: true,
            assessment: 'not_required',
            rationale: null,
          },
        ],
        priorYear: [
          {
            ...base,
            id: 'p1',
            matterCode: 'PY-001',
            matterType: 'caro_exception',
            description: 'Clause 3(vii) statutory dues delayed.',
            sourceEvidence: null,
            documentId: null,
            assessment: 'still_relevant',
            assessmentNote: null,
            signalId: null,
            signalCode: 'PS-005',
          },
          {
            ...base,
            id: 'p2',
            matterCode: 'PY-002',
            matterType: 'unadjusted_misstatement',
            description: 'Resolved one.',
            sourceEvidence: null,
            documentId: null,
            assessment: 'resolved',
            assessmentNote: 'Corrected in books.',
            signalId: null,
            signalCode: null,
          },
        ],
        acceptance: [
          {
            matterId: 'm1',
            matterCode: 'M-002',
            title: 'Predecessor communication pending',
            category: 'predecessor',
            severity: 'high',
            matterStatus: 'open',
            matterResolution: null,
            action: 'create_signal',
            signalId: 'x',
            signalCode: 'PS-006',
            reason: null,
            version: 1,
          },
        ],
      },
    );
    expect(text).toContain('No additional scope considerations beyond Section 02 (AS-02).');
    expect(text).toContain('Component reporting dependency (Relevant) [PS-004]');
    expect(text).toContain('Detailed scheduling is performed in 03.11.');
    expect(text).not.toContain('Tax expertise');
    expect(text).toContain('Component / other auditor considerations\n- PS-004 CFS required.');
    expect(text).toContain(
      'PY-001 CARO exception: Clause 3(vii) statutory dues delayed. (Still relevant) [PS-005]',
    );
    expect(text).not.toContain('Resolved one.');
    expect(text).toContain(
      'M-002 Predecessor communication pending (Create Planning Signal) [PS-006]',
    );
  });

  it('opens Engagement characteristics and Scope with the Section 01/02 facts', () => {
    const text = composeStrategySummary(record({ additionalScopeRequired: false }), [], [], {
      considerations: [],
      priorYear: [],
      acceptance: [],
      facts: {
        entity_class: 'Public company',
        listed: true,
        special_entity_types: ['NBFC'],
        reporting_framework_label: 'Ind AS',
        first_time_ind_as: true,
        schedule_iii_label: 'Schedule III Division II',
        initial_audit: true,
        joint_audit: false,
        caro: 'applicable',
        icfr: 'applicable',
        cfs: 'not_required',
        rule_11_items: 2,
        audit_trail: true,
        s197: false,
      },
    });
    expect(text).toContain(
      'Engagement characteristics\n- Public company; listed; NBFC; Ind AS (first-time adoption); Schedule III Division II; initial audit.',
    );
    expect(text).toContain(
      'Scope considerations\n- Section 02 reporting scope: CARO 2020; ICFR (Section 143(3)(i)); Rule 11 (2 matters); audit trail (Rule 11(g)).\n- No additional scope considerations beyond Section 02 (AS-02).',
    );
  });
});

describe('Strategy Summary fact lines', () => {
  it('returns null when nothing is known', () => {
    expect(characteristicsLine({})).toBeNull();
    expect(reportingScopeLine({ caro: 'not_applicable', rule_11_items: 0 })).toBeNull();
  });

  it('describes a continuing joint audit with one Rule 11 matter and CFS', () => {
    expect(characteristicsLine({ initial_audit: false, joint_audit: true })).toBe(
      'Continuing audit; joint audit.',
    );
    expect(reportingScopeLine({ cfs: 'cfs_required', rule_11_items: 1, s197: true })).toBe(
      'Section 02 reporting scope: consolidated financial statements; Rule 11 (1 matter); Section 197(16).',
    );
  });
});
