import { cardsForRole } from '../dashboard-cards';

describe('cardsForRole', () => {
  it('gives the Managing Partner the full firm-wide card set incl. sign-offs & high risk', () => {
    const keys = cardsForRole('managing_partner').map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'activeEngagements',
        'pendingSignoffs',
        'pendingReviews',
        'clientDependencies',
        'highRisk',
        'myTasks',
      ]),
    );
  });

  it('does not give a manager the EP sign-off card', () => {
    const keys = cardsForRole('manager').map((c) => c.key);
    expect(keys).not.toContain('pendingSignoffs');
    expect(keys).toContain('pendingReviews');
  });

  it('shows a senior a personal-work view (no governance cards)', () => {
    const keys = cardsForRole('senior').map((c) => c.key);
    expect(keys).toContain('myTasks');
    expect(keys).not.toContain('pendingReviews');
    expect(keys).not.toContain('pendingSignoffs');
  });

  it('falls back to My Tasks for an unknown/no role', () => {
    expect(cardsForRole(undefined).map((c) => c.key)).toEqual(['myTasks']);
  });

  it('every card maps to a real summary value key', () => {
    const validValues = new Set([
      'activeEngagements',
      'overdueCompliance',
      'dueSoonCompliance',
      'pendingReviews',
      'pendingSignoffs',
      'openClientDependencies',
      'highRisk',
      'myOpenTasks',
      'myOverdueTasks',
      'unreadNotifications',
    ]);
    for (const card of cardsForRole('managing_partner')) {
      expect(validValues.has(card.value)).toBe(true);
    }
  });
});
