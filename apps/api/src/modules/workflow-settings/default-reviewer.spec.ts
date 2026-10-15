import { reviewerCandidates } from './default-reviewer';

const c = { streamLead: 'lead', manager: 'mgr', partner: 'ptr' };

describe('reviewerCandidates', () => {
  it('follows the firm’s choice', () => {
    expect(reviewerCandidates('engagement_manager', c, 'prep')).toBe('mgr');
    expect(reviewerCandidates('engagement_partner', c, 'prep')).toBe('ptr');
    expect(reviewerCandidates('stream_lead', c, 'prep')).toBe('lead');
  });

  it('never picks the preparer, and falls back when the choice is missing', () => {
    expect(reviewerCandidates('stream_lead', c, 'lead')).toBe('mgr');
    expect(reviewerCandidates('stream_lead', { ...c, streamLead: null }, 'prep')).toBe('mgr');
    expect(reviewerCandidates('engagement_manager', { ...c, manager: 'prep' }, 'prep')).toBe('ptr');
    expect(reviewerCandidates('engagement_partner', { ...c, partner: null }, 'prep')).toBe('mgr');
  });

  it('is null when nobody but the preparer could review', () => {
    expect(
      reviewerCandidates(
        'engagement_manager',
        { streamLead: null, manager: 'p', partner: null },
        'p',
      ),
    ).toBeNull();
  });
});
