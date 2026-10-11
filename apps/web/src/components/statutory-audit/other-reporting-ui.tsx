'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  REPORTING_APPLICABILITY_LABEL,
  REPORTING_CARD as CARD,
  REPORTING_STATUS_LABEL,
  TRI_LABEL,
  type ReportingApplicability,
  type ReportingCardKey,
  type ReportingStatus,
  type SetOtherReportingFactsInput,
  type Tri,
} from '@hsdg/contracts';
import { Badge, Card } from '@/components/ui';
import { Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

/** Building blocks shared by the 02.7 workspace panels (inline expand, never pop-ups). */

/** A partial 02.7 facts save (the workspace adds the version). */
export type FactsPatch = Omit<SetOtherReportingFactsInput, 'version'>;

export const rupees = (v: number | null | undefined): string =>
  v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`;

export function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
export const str = (v: number | null | undefined): string => (v == null ? '' : String(v));

const APPLICABILITY_TONE: Record<ReportingApplicability, string> = {
  applicable: 'info',
  not_applicable: 'neutral',
  not_applicable_to_facts: 'neutral',
  pending: 'warn',
  cross_reference: 'neutral',
  conditional: 'warn',
};
export function ApplicabilityBadge({ value }: { value: ReportingApplicability }): JSX.Element {
  return (
    <Badge tone={APPLICABILITY_TONE[value] ?? 'neutral'}>
      {REPORTING_APPLICABILITY_LABEL[value] ?? value}
    </Badge>
  );
}

const STATUS_TONE: Partial<Record<ReportingStatus, string>> = {
  unmodified_expected: 'success',
  modified_wording_expected: 'danger',
  not_determined: 'warn',
};
export function ReportingStatusBadge({ value }: { value: ReportingStatus }): JSX.Element {
  return (
    <Badge tone={STATUS_TONE[value] ?? 'neutral'}>{REPORTING_STATUS_LABEL[value] ?? value}</Badge>
  );
}

/** A Yes / No / Pending select. */
export function TriSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: Tri;
  onChange: (v: Tri) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
      <span className="text-ink">{label}</span>
      <Select
        className="w-32"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Tri)}
      >
        {(Object.keys(TRI_LABEL) as Tri[]).map((t) => (
          <option key={t} value={t}>
            {TRI_LABEL[t]}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** The workspace panel that holds each card's workpaper (spec §16 "Open Workpaper"). */
export const CARD_WORKPAPER_SECTION: Record<ReportingCardKey, string> = {
  [CARD.s143Information]: 'or-143-facts',
  [CARD.s143Books]: 'or-143-facts',
  [CARD.s143BranchReturns]: 'or-cross-refs',
  [CARD.s143BranchReport]: 'or-cross-refs',
  [CARD.s143Agreement]: 'or-143-facts',
  [CARD.s143Standards]: 'or-143-facts',
  [CARD.s143Adverse]: 'or-143-facts',
  [CARD.s143Directors]: 'or-directors',
  [CARD.s143AccountsQualification]: 'or-143-facts',
  [CARD.s143Icfr]: 'or-cross-refs',
  [CARD.s143Other]: 'or-143-facts',
  [CARD.r11Litigation]: 'or-rule11',
  [CARD.r11Losses]: 'or-rule11',
  [CARD.r11Iepf]: 'or-rule11',
  [CARD.r11eAdvanced]: 'or-rule11',
  [CARD.r11eReceived]: 'or-rule11',
  [CARD.r11fDividend]: 'or-rule11',
  [CARD.r11gAuditTrail]: 'or-audit-trail',
  [CARD.s197Remuneration]: 'or-197',
  [CARD.s143_12Fraud]: 'or-fraud',
  [CARD.branchReporting]: 'or-cross-refs',
  [CARD.caro]: 'or-cross-refs',
};

const OPEN_SECTION_EVENT = 'hsdg:or-open-section';

/** Expand a workspace panel in place and bring it into view. */
export function openWorkspaceSection(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_SECTION_EVENT, { detail: id }));
}

export function Section({
  id,
  title,
  badge,
  open: initial = false,
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  open?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      setOpen(true);
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
      );
    };
    window.addEventListener(OPEN_SECTION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen);
  }, [id]);
  return (
    <Card id={id} className="scroll-mt-2 p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full flex-wrap items-center gap-2.5 text-left"
      >
        <ExpandToggle open={open} />
        <span className="text-sm font-semibold text-ink">{title}</span>
        {badge}
      </button>
      {open && <div className="mt-3 space-y-3 pl-7">{children}</div>}
    </Card>
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-sm text-ink">{value ?? '—'}</dd>
    </div>
  );
}
