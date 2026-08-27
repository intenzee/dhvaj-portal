import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import type { CardDef, CardTone } from '@/lib/dashboard-cards';

const ICON_TINT: Record<CardTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  info: 'bg-primary-50 text-primary-600',
  warn: 'bg-warning-50 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
  success: 'bg-success-50 text-success-600',
};

const VALUE_COLOR: Record<CardTone, string> = {
  neutral: 'text-ink',
  info: 'text-ink',
  warn: 'text-warning-700',
  danger: 'text-danger-600',
  success: 'text-success-700',
};

/** One dashboard metric — big number, tinted icon, and a link to the underlying list. */
export function StatCard({ card, value }: { card: CardDef; value: number }): JSX.Element {
  const Icon = card.icon;
  return (
    <div className="flex flex-col rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between">
        <div className="text-[13px] font-medium text-ink-muted">{card.label}</div>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', ICON_TINT[card.tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <div className={cn('mt-1 text-3xl font-bold tabular-nums', VALUE_COLOR[card.tone])}>
        {formatCount(value)}
      </div>
      <Link
        href={card.href}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
      >
        View all <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
