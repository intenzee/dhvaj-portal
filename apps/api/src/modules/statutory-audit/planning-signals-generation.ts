import {
  PLANNING_ATTENTION,
  PLANNING_DESTINATION,
  PLANNING_SIGNAL_SOURCE,
  type PlanningAttention,
  type PlanningDestination,
  type PlanningSignalSource,
} from '@hsdg/contracts';

/**
 * 03.1 Engagement Intelligence — pure, DB-free signal deriver (DHVAJ 03.1 §5, §8).
 *
 * Reads the CONFIRMED Section 01/02 facts (entity profile SA-triggers + framework
 * applicability conclusions) and emits the baseline Planning Signals. The source
 * sections remain authoritative — a signal is a pointer to a fact, never a copy,
 * and corrections route back to the source. Mirrors matters-generation.ts so it
 * unit-tests without a database.
 *
 * A derived signal is NOT a risk: it only proposes an attention level and
 * suggested downstream destinations for the Manager to assess (§9, §10).
 */

/** Normalised facts the intelligence generator reads (unknowns are false/absent). */
export interface EngagementIntelligenceFacts {
  /** 02.1 — first statutory audit of the entity by the firm. */
  initialAudit: boolean;
  /** 02.1 — joint audit (SA 299). */
  jointAudit: boolean;
  /** 02.4 — accounting environment; outsourced/hybrid implies a service org. */
  accountingEnvironment: 'in_house' | 'outsourced_service_organisation' | 'hybrid' | null;
  /** SA-trigger flags carried forward from 02.1 (guide §9.1). */
  sa510: boolean;
  sa402: boolean;
  sa299: boolean;
  /** Framework applicability conclusions by area key (only decided areas). */
  frameworkConclusions: Readonly<Record<string, 'applicable' | 'not_applicable'>>;
}

/** A signal proposed by the generator, keyed by a stable rule for idempotency. */
export interface DerivedSignal {
  /** Stable idempotency key (upsert-by-rule); also the auto rule_key column. */
  ruleKey: string;
  source: PlanningSignalSource;
  observation: string;
  whyMayMatter: string;
  potentialImplications: string;
  suggestedAttention: PlanningAttention;
  destinations: PlanningDestination[];
  /** Deep-link hint to the source section for "view source". */
  sourceLink: string;
}

function fw(
  facts: EngagementIntelligenceFacts,
  areaKey: string,
): 'applicable' | 'not_applicable' | undefined {
  return facts.frameworkConclusions[areaKey];
}

/**
 * Derive the baseline Engagement Intelligence signals from Section 01/02 facts.
 * Only configured, applicable facts produce a signal (spec acceptance test:
 * "ICFR/CFS/component/service-organisation facts generate only the configured
 * applicable signals").
 */
export function deriveEngagementSignals(facts: EngagementIntelligenceFacts): DerivedSignal[] {
  const out: DerivedSignal[] = [];

  // Initial audit / opening balances (SA 510).
  if (facts.initialAudit || facts.sa510) {
    out.push({
      ruleKey: 'initial_audit',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'This is the first statutory audit of the entity by the firm.',
      whyMayMatter:
        'Opening balances, predecessor information and historical accounting practices may require additional attention (SA 510).',
      potentialImplications:
        'Opening balances, comparatives, accounting-policy consistency and process understanding.',
      suggestedAttention: PLANNING_ATTENTION.enhanced,
      destinations: [PLANNING_DESTINATION.scope0304, PLANNING_DESTINATION.section04],
      sourceLink: 'section-02/entity-profile',
    });
  }

  // Service organisation (SA 402).
  const outsourced =
    facts.accountingEnvironment === 'outsourced_service_organisation' ||
    facts.accountingEnvironment === 'hybrid';
  if (facts.sa402 || outsourced) {
    out.push({
      ruleKey: 'service_organisation',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'A financially relevant process is handled by a service organisation.',
      whyMayMatter: 'The audit may need to consider controls at the service organisation (SA 402).',
      potentialImplications:
        'Assurance report availability, complementary user controls and evidence strategy.',
      suggestedAttention: PLANNING_ATTENTION.standard,
      destinations: [PLANNING_DESTINATION.scope0304],
      sourceLink: 'section-02/entity-profile',
    });
  }

  // Joint audit (SA 299).
  if (facts.jointAudit || facts.sa299) {
    out.push({
      ruleKey: 'joint_audit',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'This is a joint audit of the financial statements.',
      whyMayMatter:
        'Division of work, coordination and joint responsibility require planning consideration (SA 299).',
      potentialImplications: 'Work allocation, coordination and joint sign-off planning.',
      suggestedAttention: PLANNING_ATTENTION.standard,
      destinations: [PLANNING_DESTINATION.scope0304, PLANNING_DESTINATION.component0309],
      sourceLink: 'section-02/entity-profile',
    });
  }

  // CARO applicable.
  if (fw(facts, 'caro') === 'applicable') {
    out.push({
      ruleKey: 'caro_applicable',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'CARO is applicable to this engagement.',
      whyMayMatter:
        'The auditor must report on the CARO matters, some of which affect planning attention.',
      potentialImplications: 'CARO reporting matters and related evidence.',
      suggestedAttention: PLANNING_ATTENTION.standard,
      destinations: [PLANNING_DESTINATION.scope0304, PLANNING_DESTINATION.section04],
      sourceLink: 'section-02/caro',
    });
  }

  // ICFR / IFC reporting applicable.
  if (fw(facts, 'ifc') === 'applicable') {
    out.push({
      ruleKey: 'icfr_applicable',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'Reporting on internal financial controls (ICFR) is applicable.',
      whyMayMatter: 'Controls and IT work is expected to be significant for the engagement.',
      potentialImplications: 'Controls understanding/testing effort, IT expertise and timing.',
      suggestedAttention: PLANNING_ATTENTION.enhanced,
      destinations: [PLANNING_DESTINATION.scope0304],
      sourceLink: 'section-02/icfr',
    });
  }

  // Consolidated financial statements required.
  if (fw(facts, 'cfs') === 'applicable') {
    out.push({
      ruleKey: 'cfs_required',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'Consolidated financial statements are required.',
      whyMayMatter:
        'Consolidation, component scoping and coordination with other auditors require planning attention.',
      potentialImplications:
        'Component scoping, consolidation adjustments and group-reporting coordination.',
      suggestedAttention: PLANNING_ATTENTION.enhanced,
      destinations: [PLANNING_DESTINATION.scope0304, PLANNING_DESTINATION.component0309],
      sourceLink: 'section-02/consolidation',
    });
  }

  // Internal audit function exists (SA 610).
  if (fw(facts, 'internal_audit') === 'applicable') {
    out.push({
      ruleKey: 'internal_audit_function',
      source: PLANNING_SIGNAL_SOURCE.section02,
      observation: 'The entity has an internal audit function.',
      whyMayMatter: 'Possible use of internal-audit work requires evaluation under SA 610.',
      potentialImplications: 'Use of internal-audit work and coordination.',
      suggestedAttention: PLANNING_ATTENTION.standard,
      destinations: [PLANNING_DESTINATION.component0309],
      sourceLink: 'section-02/framework',
    });
  }

  return out;
}
