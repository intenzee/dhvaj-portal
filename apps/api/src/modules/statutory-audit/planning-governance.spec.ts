import { ForbiddenException } from '@nestjs/common';
import { PLANNING_ACTOR_ROLE, planningVersionLabel, type PlanningActorRole } from '@hsdg/contracts';
import { itemsForDestinations, moduleForItem, ORIENTATION_ITEMS } from './planning-downstream';
import {
  assertPlanningCapability,
  planningCapabilities,
  signalAuthorship,
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

describe('03.1 §23 capability matrix', () => {
  it('lets the engagement team propose and record facts only', () => {
    expect(planningCapabilities(PLANNING_ACTOR_ROLE.team)).toEqual({
      proposeSignals: true,
      addFacts: true,
      assess: false,
      focusAreas: false,
      discussion: false,
      partnerSignals: false,
      partnerReview: false,
      respondToChallenge: false,
      reopen: false,
    });
  });

  it('gives the Manager assessment and completion, not the Partner review', () => {
    const m = planningCapabilities(PLANNING_ACTOR_ROLE.manager);
    expect(m).toMatchObject({
      assess: true,
      focusAreas: true,
      respondToChallenge: true,
      reopen: true,
    });
    expect(m).toMatchObject({ partnerSignals: false, partnerReview: false });
  });

  it('keeps the EP a reviewer unless no Manager is assigned', () => {
    const p = planningCapabilities(PLANNING_ACTOR_ROLE.partner);
    expect(p).toMatchObject({
      partnerReview: true,
      partnerSignals: true,
      focusAreas: true,
      reopen: true,
    });
    expect(p).toMatchObject({ assess: false, respondToChallenge: false });
    expect(planningCapabilities(PLANNING_ACTOR_ROLE.partner, true)).toMatchObject({
      assess: true,
      respondToChallenge: true,
      partnerReview: true,
    });
  });

  it('grants nothing by firm role alone (oversight / admin / unassigned)', () => {
    for (const role of [PLANNING_ACTOR_ROLE.oversight, PLANNING_ACTOR_ROLE.none]) {
      expect(Object.values(planningCapabilities(role)).some(Boolean)).toBe(false);
    }
  });

  it('names the denied capability and the caller’s role in the 403', () => {
    expect(() => assertPlanningCapability(actor(PLANNING_ACTOR_ROLE.team), 'assess')).toThrow(
      ForbiddenException,
    );
    expect(() => assertPlanningCapability(actor(PLANNING_ACTOR_ROLE.team), 'assess')).toThrow(
      /Engagement Manager assesses.*You are: Engagement team/,
    );
  });
});

describe('03.1 signal authorship', () => {
  it('makes a team signal a proposal by its author', () => {
    expect(signalAuthorship(actor(PLANNING_ACTOR_ROLE.team), 'manager')).toBe('emp-1');
  });

  it('treats Manager signals (and an EP acting as Manager) as assessed-by-author', () => {
    expect(signalAuthorship(actor(PLANNING_ACTOR_ROLE.manager), 'manager')).toBeNull();
    expect(signalAuthorship(actor(PLANNING_ACTOR_ROLE.partner, true), 'manager')).toBeNull();
  });

  it('reserves Partner signals for the EP', () => {
    expect(signalAuthorship(actor(PLANNING_ACTOR_ROLE.partner), 'partner')).toBeNull();
    expect(() => signalAuthorship(actor(PLANNING_ACTOR_ROLE.manager), 'partner')).toThrow(
      /Only the Engagement Partner may raise Partner signals/,
    );
    expect(() => signalAuthorship(actor(PLANNING_ACTOR_ROLE.none), 'manager')).toThrow(
      ForbiddenException,
    );
  });
});

describe('03.1 downstream routing', () => {
  it('maps destinations to the Phase 03 rows they reopen (deduplicated)', () => {
    expect(itemsForDestinations(['03.8', '03.8', '03.11'])).toEqual([
      'team_allocation',
      'specialist_planning',
      'timeline_milestones',
    ]);
    // 03.4 / 03.5 route through their own modules; Section 04 has no row.
    expect(itemsForDestinations(['03.4', '03.5', 'section_04'])).toEqual([]);
  });

  it('labels a flagged row with its planning module', () => {
    expect(ORIENTATION_ITEMS.map(moduleForItem)).toEqual(['03.6', '03.7']);
    expect(moduleForItem('overall_audit_plan')).toBe('03.4');
    expect(moduleForItem('unknown_item')).toBe('03');
  });
});

describe('03.1 version label', () => {
  it('counts controlled revisions as minor versions', () => {
    expect(planningVersionLabel(1)).toBe('v1.0');
    expect(planningVersionLabel(2)).toBe('v1.1');
    expect(planningVersionLabel(0)).toBe('v1.0');
  });
});
