import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import type { CardDef, CardTone } from '@/lib/dashboard-cards';

const TONE_ACCENT: Record<CardTone, string> = {
  neutral: 'border-l-slate-300',
  info: 'border-l-brand-500',
  warn: 'border-l-amber-400',
  danger: 'border-l-rose-500',
};

const TONE_VALUE: Record<CardTone, string> = {
  neutral: 'text-ink',
  info: 'text-brand-700',
  warn: 'text-amber-700',
  danger: 'text-rose-700',
};

/** One dashboard metric, linking to the screen that lists the underlying items. */
export function StatCard({ card, value }: { card: CardDef; value: number }): JSX.Element {
  return (
    <Link
      href={card.href}
      className={cn(
        'block rounded-lg border border-l-4 border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500',
        TONE_ACCENT[card.tone],
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{card.label}</div>
      <div className={cn('mt-2 text-3xl font-semibold tabular-nums', TONE_VALUE[card.tone])}>
        {formatCount(value)}
      </div>
    </Link>
  );
}
