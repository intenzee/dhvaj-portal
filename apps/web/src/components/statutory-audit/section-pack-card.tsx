'use client';

import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import type { SectionPack, SignOffCheck } from '@hsdg/contracts';
import { openAuditPhase } from './audit-file-nav';

/**
 * A section's checks, each with the facts behind it and — when not met — a
 * link straight to where it is put right (Sections 01–04, 09, 10).
 */
export function PackCheckList({
  title,
  checks,
}: {
  title: string;
  checks: SignOffCheck[];
}): JSX.Element {
  return (
    <div>
      <p className="text-xs font-medium text-ink">{title}</p>
      <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
        {checks.map((c) => {
          const Icon = c.ok ? CheckCircle2 : c.blocking ? XCircle : AlertTriangle;
          const tone = c.ok
            ? 'text-emerald-600'
            : c.blocking
              ? 'text-danger-600'
              : 'text-amber-600';
          return (
            <li key={c.key} className="flex gap-2 px-3 py-2 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-ink">{c.label}</p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-ink-muted">
                  {c.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {c.goTo && (
                  <button
                    type="button"
                    onClick={() => openAuditPhase(c.goTo!.phaseKey, c.goTo!.anchor)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
                  >
                    {c.goTo.label}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What a section's approval needs and what is worth knowing, from the file. */
export function SectionPackChecks({
  pack,
  needsTitle = 'What approval needs',
}: {
  pack: SectionPack;
  needsTitle?: string;
}): JSX.Element {
  const blocking = pack.checks.filter((c) => c.blocking);
  const advisory = pack.checks.filter((c) => !c.blocking);
  return (
    <div className="space-y-3">
      {blocking.length > 0 && <PackCheckList title={needsTitle} checks={blocking} />}
      {advisory.length > 0 && (
        <PackCheckList
          title={
            pack.attention > 0
              ? `Worth knowing (${pack.attention} — never blocks)`
              : 'Worth knowing'
          }
          checks={advisory}
        />
      )}
    </div>
  );
}
