import { ForbiddenException } from '@nestjs/common';
import { PLANNING_ACTOR_ROLE, type PlanningActorRole } from '@hsdg/contracts';
import {
  challengeTargetLabel,
  diffUnderstandingSnapshots,
  type UnderstandingSnapshot,
} from './audit-business-understanding.service';
import {
  assertPlanningCapability,
  planningCapabilities,
  type PlanningActor,
} from './planning-governance';

const actor = (role: PlanningActorRole, actingAsManager = false): PlanningActor => ({
  role,
  actingAsManager,
  employeeId: 'emp-1',
  partnerId: 'emp-p',
  managerId: actingAsManager ? null : 'emp-m',
  capabilities: planningCapabilities(role, actingAsManager),
});

const snap = (over: Partial<UnderstandingSnapshot> = {}): UnderstandingSnapshot => ({
  record: {
    ba01: 'yes_complete',
    conclusionSummary: 'Stable business.',
    industryProfile: 'general',
  },
  sections: [
    {
      key: 'business_model',
      anythingChanged: 'no',
      answers: { activities: ['Services'], products: [['Cloud', 'Services']] },
      reviewed: true,
    },
  ],
  values: [{ metricKey: 'revenue', label: 'Revenue', period: 'cy', amount: 100 }],
  cards: [
    {
      id: 'c1',
      code: 'AX-001',
      observation: 'Revenue up 40%',
      assessment: null,
      signalCode: null,
      status: 'open',
    },
  ],
  expectations: [{ id: 'e1', label: 'Revenue', conclusion: null }],
  ...over,
});

describe('03.2 §23 roles (scoped denial)', () => {
  it('lets the team record facts and propose signals but not assess, review or complete', () => {
    const team = actor(PLANNING_ACTOR_ROLE.team);
    expect(() => assertPlanningCapability(team, 'addFacts', '03.2')).not.toThrow();
    expect(() => assertPlanningCapability(team, 'proposeSignals', '03.2')).not.toThrow();
    for (const cap of ['assess', 'reopen', 'focusAreas', 'respondToChallenge'] as const) {
      expect(() => assertPlanningCapability(team, cap, '03.2')).toThrow(ForbiddenException);
    }
  });

  it('names 03.2 (not 03.1) in the denial when the scope is 03.2', () => {
    let message = '';
    try {
      assertPlanningCapability(actor(PLANNING_ACTOR_ROLE.team), 'assess', '03.2');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/03\.2/);
    expect(message).not.toMatch(/03\.1/);
  });

  it('keeps the EP a reviewer (challenge, reopen) unless acting as Manager', () => {
    const ep = actor(PLANNING_ACTOR_ROLE.partner);
    expect(() => assertPlanningCapability(ep, 'partnerReview', '03.2')).not.toThrow();
    expect(() => assertPlanningCapability(ep, 'reopen', '03.2')).not.toThrow();
    expect(() => assertPlanningCapability(ep, 'assess', '03.2')).toThrow(ForbiddenException);
    const acting = actor(PLANNING_ACTOR_ROLE.partner, true);
    expect(() => assertPlanningCapability(acting, 'assess', '03.2')).not.toThrow();
  });

  it('lets the Manager respond to challenges but not raise them', () => {
    const mgr = actor(PLANNING_ACTOR_ROLE.manager);
    expect(() => assertPlanningCapability(mgr, 'respondToChallenge', '03.2')).not.toThrow();
    expect(() => assertPlanningCapability(mgr, 'partnerReview', '03.2')).toThrow(
      ForbiddenException,
    );
  });
});

describe('challengeTargetLabel (§23 comments)', () => {
  it('labels a section by its code and title', () => {
    expect(challengeTargetLabel('section', 'business_model', null, null)).toBe(
      '03.2.1 Business & Operating Model',
    );
  });

  it('labels a card by its AX code and an expectation by its metric', () => {
    expect(challengeTargetLabel('exception', 'x', 7, null)).toBe('AX-007');
    expect(challengeTargetLabel('expectation', 'x', null, 'revenue')).toMatch(/^Expectation — /);
  });

  it('falls back to the area label when no specific item is named', () => {
    expect(challengeTargetLabel('section', null, null, null)).toBe('03.2 section');
    expect(challengeTargetLabel('conclusion', null, null, null)).toMatch(/03\.2\.10/);
    expect(challengeTargetLabel('dataset', null, null, null)).toMatch(/03\.2\.7/);
  });
});

describe('diffUnderstandingSnapshots (§20 revision view)', () => {
  it('reports nothing for identical versions', () => {
    expect(diffUnderstandingSnapshots(snap(), snap())).toEqual([]);
  });

  it('reports changed, added and removed figures', () => {
    const after = snap({
      values: [
        { metricKey: 'revenue', label: 'Revenue', period: 'cy', amount: 120 },
        { metricKey: 'revenue', label: 'Revenue', period: 'py', amount: 90 },
      ],
    });
    const changes = diffUnderstandingSnapshots(snap(), after);
    expect(changes).toEqual(
      expect.arrayContaining([
        { area: 'figure', label: 'Revenue (CY)', before: '100', after: '120' },
        { area: 'figure', label: 'Revenue (PY)', before: null, after: '90' },
      ]),
    );
    expect(diffUnderstandingSnapshots(after, snap())).toEqual(
      expect.arrayContaining([
        { area: 'figure', label: 'Revenue (PY)', before: '90', after: null },
      ]),
    );
  });

  it('catches an edited table row even when the row count is unchanged', () => {
    const after = snap({
      sections: [
        {
          key: 'business_model',
          anythingChanged: 'yes',
          answers: { activities: ['Services'], products: [['Cloud migration', 'Services']] },
          reviewed: false,
        },
      ],
    });
    const changes = diffUnderstandingSnapshots(snap(), after);
    expect(changes.map((c) => c.area)).toEqual(['section', 'section']);
    expect(changes.find((c) => c.label.endsWith('Anything changed?'))).toMatchObject({
      before: 'no',
      after: 'yes',
    });
    expect(changes.find((c) => c.before === 'Cloud | Services')).toMatchObject({
      after: 'Cloud migration | Services',
    });
  });

  it('reports card assessments, signals, expectation conclusions and the conclusion text', () => {
    const after = snap({
      record: {
        ba01: null,
        conclusionSummary: 'Revenue growth explained.',
        industryProfile: 'general',
      },
      cards: [
        {
          id: 'c1',
          code: 'AX-001',
          observation: 'Revenue up 40%',
          assessment: 'further_information_required',
          signalCode: 'PS-003',
          status: 'assessed',
        },
      ],
      expectations: [{ id: 'e1', label: 'Revenue', conclusion: 'normal' }],
    });
    const changes = diffUnderstandingSnapshots(snap(), after);
    const card = changes.find((c) => c.area === 'exception')!;
    expect(card.before).toBe('Not assessed');
    expect(card.after).toMatch(/PS-003$/);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'conclusion',
          label: 'Expectation — Revenue',
          before: 'Not concluded',
        }),
        expect.objectContaining({
          area: 'conclusion',
          before: 'Stable business.',
          after: 'Revenue growth explained.',
        }),
      ]),
    );
  });
});
