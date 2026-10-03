import type { RiskAssertion, RiskRating, RiskSource } from '@hsdg/contracts';

/**
 * Section 04 — suggested risks of material misstatement, from what the file
 * already knows (Guide §1, capture once). Pure: the service reads Sections
 * 02–03 and inserts what this plans, each with a stable `sourceKey` and a note
 * saying where it came from.
 *
 * A Planning Signal is NOT a risk (03.1). A signal the Manager rated Enhanced
 * or Partner attention, or assessed "potential risk — assess further", is a
 * CANDIDATE: it is suggested here for the team to rate, respond to or delete.
 * Only the two SA 240 presumptions and last year's still-relevant significant
 * risks arrive flagged significant; everything else starts below that.
 */

export interface RiskSuggestionFacts {
  isInitialAudit: boolean;
  hasGroupRelationships: boolean;
  signals: Array<{
    id: string;
    code: string;
    source: string;
    observation: string;
    whyMayMatter: string | null;
    attention: 'standard' | 'enhanced' | 'immediate_partner';
    managerAssessment: string | null;
    status: string;
  }>;
  priorYearMatters: Array<{
    id: string;
    code: string;
    matterType: string;
    description: string;
    assessment: string | null;
  }>;
  enhancedAreas: Array<{ id: string; name: string; reason: string | null }>;
}

export interface SuggestedRisk {
  sourceKey: string;
  sourceNote: string;
  description: string;
  source: RiskSource;
  fsArea: string | null;
  assertion: RiskAssertion | null;
  rating: RiskRating;
  isSignificant: boolean;
  isFraudRisk: boolean;
  response: string | null;
}

const SIGNAL_SOURCE: Record<string, RiskSource> = {
  analytics: 'analytical_review',
  prior_year: 'prior_year',
  section_02: 'regulatory',
  section_01: 'inquiry',
  current_year_change: 'inquiry',
};

const PY_TYPE: Record<string, { source: RiskSource; rating: RiskRating; significant: boolean }> = {
  significant_risk: { source: 'prior_year', rating: 'significant', significant: true },
  significant_estimate: { source: 'estimate', rating: 'high', significant: false },
  control_deficiency: { source: 'control_deficiency', rating: 'moderate', significant: false },
  unadjusted_misstatement: { source: 'error', rating: 'moderate', significant: false },
};

const clip = (s: string, n = 900) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function suggestRisks(f: RiskSuggestionFacts): SuggestedRisk[] {
  const out: SuggestedRisk[] = [
    {
      sourceKey: 'sa240:management_override',
      sourceNote: 'SA 240.31 — presumed in every audit; cannot be rebutted',
      description: 'Risk of management override of controls.',
      source: 'fraud',
      fsArea: 'Journal entries & management estimates',
      assertion: null,
      rating: 'significant',
      isSignificant: true,
      isFraudRisk: true,
      response:
        'Test the appropriateness of journal entries and other adjustments (SA 240.32(a)); review accounting estimates for bias (32(b)); evaluate the business rationale of significant unusual transactions (32(c)).',
    },
    {
      sourceKey: 'sa240:revenue_recognition',
      sourceNote: 'SA 240.26 — presumed; if rebutted, record the reasons (SA 240.47)',
      description: 'Presumed risk of fraud in revenue recognition.',
      source: 'fraud',
      fsArea: 'Revenue',
      assertion: 'occurrence',
      rating: 'significant',
      isSignificant: true,
      isFraudRisk: true,
      response:
        'Cut-off testing either side of the period end; vouch a sample of revenue to contracts, dispatch and receipt; analytics on revenue by stream and month; review credit notes after the period end.',
    },
  ];

  for (const s of f.signals) {
    if (s.status === 'closed' || s.managerAssessment === 'not_relevant') continue;
    const candidate =
      s.attention !== 'standard' || s.managerAssessment === 'potential_risk_assess_further';
    if (!candidate) continue;
    out.push({
      sourceKey: `signal:${s.id}`,
      sourceNote: `Planning signal ${s.code} (${
        s.attention === 'immediate_partner'
          ? 'Partner attention'
          : s.attention === 'enhanced'
            ? 'Enhanced'
            : 'potential risk'
      })`,
      description: clip(
        `${s.observation.trim()}${s.whyMayMatter ? ` — ${s.whyMayMatter.trim()}` : ''}`,
      ),
      source: SIGNAL_SOURCE[s.source] ?? 'other',
      fsArea: null,
      assertion: null,
      rating: s.attention === 'immediate_partner' ? 'high' : 'moderate',
      isSignificant: false,
      isFraudRisk: false,
      response: null,
    });
  }

  for (const m of f.priorYearMatters) {
    const t = PY_TYPE[m.matterType];
    if (!t || m.assessment === 'resolved') continue;
    out.push({
      sourceKey: `py:${m.id}`,
      sourceNote: `Prior-year matter ${m.code}${m.assessment ? ` (${m.assessment.replace(/_/g, ' ')})` : ' (not yet reassessed)'}`,
      description: clip(m.description.trim()),
      source: t.source,
      fsArea: null,
      assertion: null,
      rating: t.rating,
      isSignificant: t.significant,
      isFraudRisk: /fraud/i.test(m.description),
      response: null,
    });
  }

  for (const a of f.enhancedAreas) {
    out.push({
      sourceKey: `area:${a.id}`,
      sourceNote: '03.5 audit area at Enhanced attention',
      description: clip(
        `${a.name}: assess the risk of material misstatement at assertion level${a.reason ? ` — ${a.reason.trim()}` : ''}.`,
      ),
      source: 'other',
      fsArea: a.name,
      assertion: null,
      rating: 'moderate',
      isSignificant: false,
      isFraudRisk: false,
      response: null,
    });
  }

  if (f.hasGroupRelationships) {
    out.push({
      sourceKey: 'sa550:related_parties',
      sourceNote: 'SA 550 — group relationships on the client master',
      description:
        'Related-party relationships and transactions may be incomplete or inadequately disclosed.',
      source: 'related_party',
      fsArea: 'Related-party transactions',
      assertion: 'presentation_and_disclosure',
      rating: 'moderate',
      isSignificant: false,
      isFraudRisk: false,
      response:
        'Obtain the related-party list and compare with the group master, minutes and registers; test transactions for approval and arm’s-length terms; check disclosures (AS 18 / Ind AS 24).',
    });
  }
  if (f.isInitialAudit) {
    out.push({
      sourceKey: 'sa510:opening_balances',
      sourceNote: 'SA 510 — first-year audit',
      description:
        'Opening balances may contain misstatements that affect the current period, and accounting policies may not be consistently applied.',
      source: 'error',
      fsArea: 'Opening balances',
      assertion: 'existence',
      rating: 'moderate',
      isSignificant: false,
      isFraudRisk: false,
      response:
        'Review the predecessor auditor’s working papers (SA 510.6); test opening balances through current-period procedures; confirm consistency of accounting policies.',
    });
  }
  return out;
}
