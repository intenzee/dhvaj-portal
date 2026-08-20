import { render, screen } from '@testing-library/react';
import { StatCard } from '../stat-card';
import type { CardDef } from '@/lib/dashboard-cards';

const card: CardDef = {
  key: 'activeEngagements',
  label: 'Active Engagements',
  value: 'activeEngagements',
  href: '/engagements?status=active',
  tone: 'info',
};

describe('StatCard', () => {
  it('renders the label, the formatted value, and links to the underlying list', () => {
    render(<StatCard card={card} value={12} />);
    expect(screen.getByText('Active Engagements')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/engagements?status=active');
  });
});
