import type {
  AreaOfFocusRecord,
  PlanningIntelligenceRecord,
  PlanningSignalRecord,
} from '@hsdg/contracts';
import { composeStrategySummary } from './audit-planning-intelligence.service';
import {
  deriveEngagementSignals,
  type EngagementIntelligenceFacts,
} from './planning-signals-generation';

const facts = (over: Partial<EngagementIntelligenceFacts> = {}): EngagementIntelligenceFacts => ({
  initialAudit: false,
  jointAudit: false,
  accountingEnvironment: 'in_house',
  sa510: false,
  sa402: false,
  sa299: false,
  frameworkConclusions: {},
  ...over,
});

const keys = (f: EngagementIntelligenceFacts) => deriveEngagementSignals(f).map((s) => s.ruleKey);

describe('deriveEngagementSignals (03.1 Engagement Intelligence)', () => {
  it('a plain continuing, in-house, no-framework-trigger engagement produces no signal', () => {
    expect(deriveEngagementSignals(facts())).toEqual([]);
  });

  it('initial audit ⇒ an Enhanced opening-balance signal pointing at the profile', () => {
    const [s] = deriveEngagementSignals(facts({ initialAudit: true }));
    expect(s!.ruleKey).toBe('initial_audit');
    expect(s!.source).toBe('section_02');
    expect(s!.suggestedAttention).toBe('enhanced');
    expect(s!.sourceLink).toBe('section-02/entity-profile');
    expect(s!.observation).toMatch(/first statutory audit/);
  });

  it('the SA 510 flag alone also triggers the initial-audit signal (no duplicate)', () => {
    expect(keys(facts({ sa510: true }))).toEqual(['initial_audit']);
    expect(keys(facts({ initialAudit: true, sa510: true }))).toEqual(['initial_audit']);
  });

  it('outsourced or hybrid accounting environment ⇒ service-organisation signal', () => {
    expect(keys(facts({ accountingEnvironment: 'outsourced_service_organisation' }))).toEqual([
      'service_organisation',
    ]);
    expect(keys(facts({ accountingEnvironment: 'hybrid' }))).toEqual(['service_organisation']);
    expect(keys(facts({ sa402: true }))).toEqual(['service_organisation']);
  });

  it('joint audit ⇒ joint-audit signal routed to scope and component planning', () => {
    const [s] = deriveEngagementSignals(facts({ jointAudit: true }));
    expect(s!.ruleKey).toBe('joint_audit');
    expect(s!.destinations).toEqual(['03.4', '03.9']);
  });

  it('only APPLICABLE framework conclusions generate signals', () => {
    expect(
      keys(
        facts({
          frameworkConclusions: {
            caro: 'applicable',
            ifc: 'applicable',
            cfs: 'applicable',
            internal_audit: 'applicable',
          },
        }),
      ),
    ).toEqual(['caro_applicable', 'icfr_applicable', 'cfs_required', 'internal_audit_function']);

    expect(
      keys(
        facts({
          frameworkConclusions: {
            caro: 'not_applicable',
            ifc: 'not_applicable',
            cfs: 'not_applicable',
            internal_audit: 'not_applicable',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('never emits a risk rating — only the three attention levels', () => {
    const all = deriveEngagementSignals(
      facts({
        initialAudit: true,
        jointAudit: true,
        sa402: true,
        frameworkConclusions: { caro: 'applicable', ifc: 'applicable', cfs: 'applicable' },
      }),
    );
    for (const s of all) {
      expect(['standard', 'enhanced', 'immediate_partner']).toContain(s.suggestedAttention);
      expect(`${s.observation} ${s.whyMayMatter}`).not.toMatch(
        /\b(high|medium|low|significant) risk\b/i,
      );
    }
  });

  it('rule keys are unique so the upsert-by-rule generator stays idempotent', () => {
    const all = keys(
      facts({
        initialAudit: true,
        jointAudit: true,
        sa402: true,
        frameworkConclusions: {
          caro: 'applicable',
          ifc: 'applicable',
          cfs: 'applicable',
          internal_audit: 'applicable',
        },
      }),
    );
    expect(new Set(all).size).toBe(all.length);
  });
});

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
});
