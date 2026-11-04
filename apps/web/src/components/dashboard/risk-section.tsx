'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  FEATURE_FLAG,
  PERMISSION,
  RISK_MONEY_TILES,
  RISK_TILE_HINT,
  RISK_TILE_LABEL,
  RISK_TILES,
  formatInr,
  riskItemHref,
  type RiskTile,
  type RiskTileKey,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import { Card, Spinner } from '@/components/ui';

/** Items a tile shows at a time on Home. */
const PAGE = 5;

/** The roles whose Home leads with the risk tiles (PS-301: the partner Home). */
const RISK_ROLES = ['managing_partner', 'partner', 'admin'];

export const riskTileKey = (key: RiskTileKey, offset: number) =>
  ['dashboard', 'risk', key, offset] as const;

/** "3 Nov" — a tile item's date. */
function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function RiskTileCard({ tileKey }: { tileKey: RiskTileKey }): JSX.Element {
  const [offset, setOffset] = useState(0);
  // Each tile reads on its own: a slow one never holds the others up.
  const q = useQuery({
    queryKey: riskTileKey(tileKey, offset),
    queryFn: () => apiFetch<RiskTile>(`/dashboard/risk/${tileKey}?limit=${PAGE}&offset=${offset}`),
    placeholderData: (prev) => prev,
    refetchInterval: 5 * 60 * 1000,
  });
  const t = q.data;
  const money = RISK_MONEY_TILES.includes(tileKey);
  const hot = !!t && t.available && t.count > 0;

  return (
    <Card
      role="region"
      aria-label={RISK_TILE_LABEL[tileKey]}
      className={cn('flex flex-col', hot && 'border-danger-200')}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">{RISK_TILE_LABEL[tileKey]}</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
            {RISK_TILE_HINT[tileKey]}
          </p>
        </div>
        {t?.available && (
          <Link href={t.href} className="text-right" title="Open the full list">
            <div
              className={cn(
                'text-2xl font-bold tabular-nums',
                t.count > 0 ? 'text-danger-700' : 'text-success-700',
              )}
            >
              {t.count}
            </div>
            {money && t.amount && Number(t.amount) > 0 && (
              <div className="text-[11px] font-medium text-ink-muted">{formatInr(t.amount)}</div>
            )}
          </Link>
        )}
      </div>
      <div className="flex-1 px-4 py-2">
        {q.isLoading && <Spinner />}
        {q.isError && <p className="py-2 text-xs text-danger-700">Could not load this tile.</p>}
        {t && !t.available && (
          <p className="py-2 text-xs text-ink-muted">Shows here once the register is in use.</p>
        )}
        {t?.available && t.count === 0 && (
          <p className="py-2 text-xs text-success-700">Nothing at risk.</p>
        )}
        {t?.available && t.items.length > 0 && (
          <ul className="divide-y divide-line">
            {t.items.map((i, n) => (
              <li key={`${offset}-${n}`}>
                <Link
                  href={riskItemHref(i)}
                  className="-mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{i.title}</div>
                    <div className="truncate text-[11px] text-ink-muted">{i.detail}</div>
                  </div>
                  {i.dueOn && (
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                      {shortDate(i.dueOn)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {t?.available && t.count > 0 && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs">
          <Link href={t.href} className="font-medium text-primary-700 hover:underline">
            See all
          </Link>
          {t.count > PAGE && (
            <div className="ml-auto flex items-center gap-1 text-ink-muted">
              <button
                type="button"
                aria-label="Previous"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
                className="rounded p-0.5 hover:bg-surface-sunken disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums">
                {offset + 1}–{Math.min(offset + PAGE, t.count)} of {t.count}
              </span>
              <button
                type="button"
                aria-label="Next"
                disabled={offset + PAGE >= t.count}
                onClick={() => setOffset(offset + PAGE)}
                className="rounded p-0.5 hover:bg-surface-sunken disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * PS-301 · "what can hurt us": the partner Home's first section, above the
 * cockpit. Nine tiles, each loaded and paged on its own; every item opens the
 * work. Behind ff_partner_risk, for report readers on a partner's Home.
 */
export function RiskSection(): JSX.Element | null {
  const { principal } = useAuth();
  const { isOn } = useFeatureFlags();
  if (!isOn(FEATURE_FLAG.partnerRisk)) return null;
  if (!can(principal, PERMISSION.reportRead)) return null;
  if (!RISK_ROLES.includes(principal?.effectiveRole ?? '')) return null;
  return (
    <section aria-label="Risk" className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-danger-600" aria-hidden />
        <h2 className="text-base font-semibold text-ink">Risk</h2>
        <span className="text-xs text-ink-muted">What can hurt the firm, as of today</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {RISK_TILES.map((k) => (
          <RiskTileCard key={k} tileKey={k} />
        ))}
      </div>
    </section>
  );
}
