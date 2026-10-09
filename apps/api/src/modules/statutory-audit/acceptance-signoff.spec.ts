import type { AcceptanceDecisionRecord, SegmentState } from '@hsdg/contracts';
import { partnerConclusionError, recommendationNeedsComment } from '@hsdg/contracts';
import { deriveSignoff, matterAnchor, type SignoffFacts } from './acceptance-signoff';

const KEYS = [
  'engagement_profile',
  'appointment_eligibility',
  'previous_auditor',
  'acceptance_continuance',
  'independence_ethics',
  'audit_preconditions',
  'engagement_letter',
  'final_acceptance',
];

function facts(over: Partial<SignoffFacts> = {}, state: SegmentState = 'complete'): SignoffFacts {
  return {
    segments: KEYS.map((k) => ({
      segmentKey: k,
      title: k,
      state: k === 'final_acceptance' ? 'not_started' : state,
      hasAnswers: state !== 'not_started',
    })),
    openMatters: [],
    engagementLetterStatus: 'issued',
    recommendation: null,
    decisions: [],
    completionFailures: [],
    preparedByName: 'Manager X',
    engagementPartnerName: 'Partner A',
    ...over,
  };
}

const decision = (over: Partial<AcceptanceDecisionRecord>): AcceptanceDecisionRecord => ({
  id: 'd1',
  version: 1,
  conclusion: 'accept',
  reason: null,
  safeguards: null,
  memo: null,
  decidedByName: 'Partner A',
  decidedAt: '2026-10-01T00:00:00Z',
  reopenedAt: null,
  reopenedByName: null,
  reopenReason: null,
  ...over,
});

describe('deriveSignoff', () => {
  it('is ready for approval when every segment is resolved, the letter progressed and nothing blocks', () => {
    const d = deriveSignoff(facts());
    expect(d.blockers).toEqual([]);
    expect(d.finalSegmentState).toBe('ready_for_approval');
    expect(d.header.completedSegments).toBe(7);
    expect(d.header.applicableSegments).toBe(7);
  });

  it('stays locked and names what is open, with links to the source', () => {
    const f = facts();
    f.segments[2]!.state = 'in_progress';
    f.openMatters = [
      {
        id: 'm',
        seq: 3,
        title: 'Independence threat',
        source: 'acceptance:independence_ethics:ind_01',
        severity: 'high',
        isBlocking: true,
      },
    ];
    const d = deriveSignoff(f);
    expect(d.finalSegmentState).toBe('locked');
    expect(d.blockers).toContain('Previous Auditor Communication is in progress.');
    expect(d.blockers.some((b) => b.includes('1 blocking acceptance matter'))).toBe(true);
    expect(d.openMatters[0]).toMatchObject({
      code: 'M-003',
      anchor: 'segment-independence_ethics',
    });
    expect(d.header.status).toBe('attention_required');
  });

  it('counts Not Applicable segments out of the progress denominator', () => {
    const f = facts();
    f.segments[2]!.state = 'not_applicable';
    const d = deriveSignoff(f);
    expect(d.header.applicableSegments).toBe(6);
    expect(d.readiness.find((r) => r.key === 'previous_auditor')).toMatchObject({
      ok: true,
      statusLabel: 'Not Applicable',
    });
  });

  it('needs the engagement letter approved, issued or accepted', () => {
    expect(deriveSignoff(facts({ engagementLetterStatus: 'draft' })).blockers[0]).toMatch(
      /engagement letter is Draft/,
    );
    expect(deriveSignoff(facts({ engagementLetterStatus: null })).blockers[0]).toMatch(
      /not been created/,
    );
  });

  it('carries the question engine’s §14 failures as blockers', () => {
    const d = deriveSignoff(
      facts({ completionFailures: ['Independence conclusion does not permit the engagement.'] }),
    );
    expect(d.blockers).toEqual(['Independence conclusion does not permit the engagement.']);
    expect(d.finalSegmentState).toBe('locked');
  });

  it('is Ready for Review once the recommendation is submitted', () => {
    const d = deriveSignoff(
      facts({
        recommendation: {
          id: 'r',
          cycle: 1,
          recommendation: 'accept',
          comments: null,
          status: 'submitted',
          submittedByName: 'Manager X',
          submittedAt: '2026-10-01T00:00:00Z',
        },
      }),
    );
    expect(d.header.status).toBe('ready_for_review');
  });

  it('is Complete with a live approval, and back to open once it is reopened', () => {
    expect(deriveSignoff(facts({ decisions: [decision({})] }))).toMatchObject({
      finalSegmentState: 'complete',
      header: { status: 'complete' },
    });
    const reopened = deriveSignoff(
      facts({ decisions: [decision({ reopenedAt: '2026-10-02T00:00:00Z', reopenReason: 'x' })] }),
    );
    expect(reopened.liveApproval).toBeNull();
    expect(reopened.finalSegmentState).toBe('ready_for_approval');
  });

  it('flags Attention Required after the partner returns the file', () => {
    const d = deriveSignoff(
      facts({ decisions: [decision({ conclusion: 'return', reason: 'more work' })] }),
    );
    expect(d.header.status).toBe('attention_required');
    expect(d.liveApproval).toBeNull();
  });

  it('is Not Started before anything is answered', () => {
    expect(
      deriveSignoff(facts({ engagementLetterStatus: null }, 'not_started')).header.status,
    ).toBe('not_started');
  });
});

describe('FINAL-01 / FINAL-02 rules', () => {
  it('needs comments only when the recommendation is not clear', () => {
    expect(recommendationNeedsComment('accept')).toBe(false);
    expect(recommendationNeedsComment('continue')).toBe(false);
    expect(recommendationNeedsComment('accept_with_safeguards')).toBe(true);
    expect(recommendationNeedsComment('partner_review_required')).toBe(true);
    expect(recommendationNeedsComment('decline')).toBe(true);
  });

  it('needs safeguards for a conditional acceptance and a reason to return or decline', () => {
    expect(partnerConclusionError({ conclusion: 'accept' })).toBeNull();
    expect(partnerConclusionError({ conclusion: 'accept_with_conditions' })).toMatch(/safeguards/);
    expect(
      partnerConclusionError({ conclusion: 'accept_with_conditions', safeguards: 'EQCR' }),
    ).toBeNull();
    expect(partnerConclusionError({ conclusion: 'return', reason: ' ' })).toMatch(/returning/);
    expect(partnerConclusionError({ conclusion: 'decline' })).toMatch(/declining/);
  });
});

describe('matterAnchor', () => {
  it('points a matter at the segment that raised it', () => {
    expect(matterAnchor('acceptance:previous_auditor:pa_05')).toBe('segment-previous_auditor');
    expect(matterAnchor('manual')).toBe('acceptance-matters');
  });
});
