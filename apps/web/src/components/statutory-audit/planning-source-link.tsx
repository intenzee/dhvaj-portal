'use client';

import { ExternalLink } from 'lucide-react';
import {
  FRAMEWORK_SOURCE_ANCHOR,
  FRAMEWORK_SOURCE_SECTION_LABEL,
  FRAMEWORK_SUMMARY_ANCHOR,
  type FrameworkSourceSection,
} from '@hsdg/contracts';
import { openAuditPhase } from './audit-file-nav';

/**
 * 03.1 source links (`<phase>:<place>`): every Planning Fact and Planning Signal
 * points back at the Section 01/02 answer it came from (§5, §22), so the team
 * reads the fact where it is owned instead of a copy.
 *
 *   framework:02.6           → the Section 02 card (raw DOM id)
 *   acceptance:question-acc_03 → the Section 01 question (audit anchor)
 *   planning:<anchor>        → a place inside Planning
 */
export interface ParsedSourceLink {
  phase: string;
  place: string;
}

export function parseSourceLink(link: string | null | undefined): ParsedSourceLink | null {
  const m = /^([a-z_]+):([A-Za-z0-9_.-]+)$/.exec(link ?? '');
  return m ? { phase: m[1]!, place: m[2]! } : null;
}

const frameworkAnchor = (section: string): string | null =>
  section === '02.8'
    ? FRAMEWORK_SUMMARY_ANCHOR
    : (FRAMEWORK_SOURCE_ANCHOR[section as FrameworkSourceSection] ?? null);

export function sourceLinkLabel(link: string | null | undefined): string | null {
  const p = parseSourceLink(link);
  if (!p) return null;
  if (p.phase === 'framework') {
    return p.place === '02.8'
      ? '02.8 Audit Framework Summary'
      : (FRAMEWORK_SOURCE_SECTION_LABEL[p.place as FrameworkSourceSection] ?? `Section ${p.place}`);
  }
  if (p.phase === 'acceptance') {
    const q = p.place.replace(/^question-/, '');
    return `Section 01 — ${q.toUpperCase().replace(/_/g, '-')}`;
  }
  if (p.phase === 'planning') return 'Section 03 — Planning';
  return `${p.phase} ${p.place}`;
}

const isShown = (el: HTMLElement | null): el is HTMLElement =>
  !!el && el.getBoundingClientRect().height > 0;

/**
 * Scroll to the first of `ids` that has rendered with content, once the opened
 * phase is up. A Section 02 card with nothing recorded yet renders empty, so
 * the link falls back to the 02.8 summary (which states every fact), then to
 * the phase itself — it never silently goes nowhere.
 */
function scrollToFirstShown(ids: readonly string[], tries = 20): void {
  const el = ids.map((id) => document.getElementById(id)).find(isShown);
  const primary = ids[0] ? document.getElementById(ids[0]) : null;
  if (!isShown(primary) && tries > 0) {
    setTimeout(() => scrollToFirstShown(ids, tries - 1), 100);
    return;
  }
  if (!el) return;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  el.classList.add('ring-2', 'ring-primary-400');
  setTimeout(() => el.classList.remove('ring-2', 'ring-primary-400'), 1600);
}

export function goToSourceLink(link: string | null | undefined): void {
  const p = parseSourceLink(link);
  if (!p) return;
  if (p.phase === 'framework') {
    openAuditPhase('framework');
    const id = frameworkAnchor(p.place);
    scrollToFirstShown(
      [id, FRAMEWORK_SUMMARY_ANCHOR, 'audit-phase-framework'].filter((x): x is string => !!x),
    );
    return;
  }
  openAuditPhase(p.phase, p.place);
}

/** "View 02.6 CFS / Group Audit ↗" — a no-op label for an unknown link. */
export function PlanningSourceLink({
  link,
  className,
}: {
  link: string | null | undefined;
  className?: string;
}): JSX.Element | null {
  const label = sourceLinkLabel(link);
  if (!label) return null;
  return (
    <button
      type="button"
      className={
        className ??
        'inline-flex items-center gap-1 text-left text-xs text-primary-700 hover:underline'
      }
      title={`View ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        goToSourceLink(link);
      }}
    >
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </button>
  );
}
