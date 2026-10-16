import { render, screen } from '@testing-library/react';
import { NoticeClockBadge, NoticeStatusBadge, money } from '../notice-bits';

describe('NoticeClockBadge', () => {
  it('shows the label, date and days left', () => {
    render(
      <NoticeClockBadge
        clock={{ due: '2026-10-23', label: 'Reply due', daysLeft: 7, overdue: false }}
      />,
    );
    const badge = screen.getByTitle('Reply due 23 Oct 2026');
    expect(badge).toHaveTextContent('Reply due· 23 Oct 2026· 7 days left');
    expect(badge.className).not.toMatch(/danger/);
  });

  it('is red when overdue', () => {
    render(
      <NoticeClockBadge
        clock={{ due: '2026-10-10', label: 'Hearing', daysLeft: -6, overdue: true }}
      />,
    );
    const badge = screen.getByTitle('Hearing 10 Oct 2026');
    expect(badge).toHaveTextContent('6 days overdue');
    expect(badge.className).toMatch(/text-danger-700/);
  });

  it('says so when no date is running', () => {
    render(<NoticeClockBadge clock={null} />);
    expect(screen.getByText('No date running')).toBeInTheDocument();
  });
});

describe('notice bits', () => {
  it('labels the status', () => {
    render(<NoticeStatusBadge status="order_received" />);
    expect(screen.getByText('Order received')).toBeInTheDocument();
  });

  it('formats ₹ in the Indian grouping', () => {
    expect(money('1250000.00')).toBe('₹12,50,000.00');
    expect(money(null)).toBe('—');
  });
});
