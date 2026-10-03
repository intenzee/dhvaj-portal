'use client';

import Link from 'next/link';
import { ArrowRight, Pencil } from 'lucide-react';
import type { MasterFact, MasterFactFix } from '@hsdg/contracts';

/**
 * Facts read from the client master, with their source — and, where the fact
 * lives on the master, a link straight to the form that adds or corrects it
 * (`/entities/:id?edit=<section>`), so nobody has to hunt for the field.
 */

export function fixHref(fix: MasterFactFix): string {
  const fy = fix.financialYear ? `&fy=${encodeURIComponent(fix.financialYear)}` : '';
  return `/entities/${fix.entityId}?edit=${fix.section}${fy}`;
}

export function FixLink({
  fix,
  missing,
  children,
}: {
  fix: MasterFactFix;
  missing: boolean;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <Link
      href={fixHref(fix)}
      className={
        missing
          ? 'inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline'
          : 'inline-flex items-center gap-1 text-xs text-ink-faint hover:text-primary-600 hover:underline'
      }
    >
      {children ?? (missing ? 'Add on client master' : 'Edit')}
      {missing ? <ArrowRight className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
    </Link>
  );
}

export function MasterFactList({
  facts,
  columns = 2,
}: {
  facts: MasterFact[];
  columns?: 2 | 3;
}): JSX.Element {
  return (
    <dl
      className={`grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 ${columns === 3 ? 'lg:grid-cols-3' : ''}`}
    >
      {facts.map((f) => (
        <div key={f.label} className="flex flex-col">
          <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
            {f.label} <span className="normal-case tracking-normal">· {f.source}</span>
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-2">
            <span className={f.value ? 'text-ink' : 'italic text-ink-faint'}>
              {f.value ?? 'Not on master'}
            </span>
            {f.fix && <FixLink fix={f.fix} missing={!f.value} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}
