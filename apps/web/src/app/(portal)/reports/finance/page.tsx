'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FEATURE_FLAG } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import { EmptyState, PageHeader } from '@/components/ui';
import { monthLabel } from '@/components/accounts/accounts';
import { canReadFinance, currentMonth, shiftMonth } from '@/components/finance/finance';
import { GstRegisterTab } from '@/components/finance/gst-register-tab';
import { BooksTab } from '@/components/finance/books-tab';
import { BankMatchTab } from '@/components/finance/bank-match-tab';

type Tab = 'gst' | 'books' | 'bank';

const TABS: { id: Tab; label: string }[] = [
  { id: 'gst', label: 'GST register' },
  { id: 'books', label: 'Books export' },
  { id: 'bank', label: 'Bank match' },
];

/** Accountant role, phase 2c (spec §3.7): Reports → Finance. */
export default function FinanceReportsPage(): JSX.Element {
  const { principal } = useAuth();
  const v2 = useFeatureFlags().isOn(FEATURE_FLAG.billing);
  const allowed = canReadFinance(principal);
  const [tab, setTab] = useState<Tab>('gst');
  const [month, setMonth] = useState(currentMonth());
  const latest = currentMonth();

  if (!allowed || !v2) {
    return (
      <div>
        <PageHeader title="Finance reports" />
        <EmptyState>
          {allowed
            ? 'Finance reports arrive with the new billing.'
            : 'Finance reports are for the Accountant and the Managing Partner.'}
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Finance reports"
        subtitle="The month's GST outward register, the books export and bank statement matching, across the firm."
        back={{ href: '/accounts', label: 'Accounts desk' }}
        actions={
          tab === 'bank' ? undefined : (
            <div className="flex items-center gap-1" aria-label="Month">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                className="rounded-md p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <span className="min-w-[6.5rem] text-center text-sm font-medium text-ink">
                {monthLabel(month)}
              </span>
              <button
                type="button"
                aria-label="Next month"
                disabled={month >= latest}
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                className="rounded-md p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )
        }
      />
      <div className="mb-4 flex gap-1 border-b border-line-strong" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition',
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'gst' && <GstRegisterTab month={month} />}
      {tab === 'books' && <BooksTab month={month} />}
      {tab === 'bank' && <BankMatchTab />}
    </div>
  );
}
