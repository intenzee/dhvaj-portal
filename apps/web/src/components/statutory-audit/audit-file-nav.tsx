'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  Users,
  AlertTriangle,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import type { AuditPhaseState, StatutoryAuditWorkflow } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { Card } from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';

/**
 * The Work-tab left audit-file navigation (Audit Spec §8, §10) — the versioned
 * workflow shell's ten phases with professional state. It is an expandable
 * professional-file tree, NOT a flat task list. Renders nothing when the
 * engagement carries no statutory-audit service, so non-audit engagements are
 * unaffected.
 *
 * Every phase has a +/− toggle at its side: `+` opens the phase's workspace
 * directly under its row, `−` collapses it again. Work happens in place in
 * the file tree — never in a pop-up.
 */

const STATE_META: Record<AuditPhaseState, { icon: LucideIcon; className: string; label: string }> =
  {
    complete: { icon: CheckCircle2, className: 'text-emerald-600', label: 'Complete' },
    in_progress: { icon: CircleDot, className: 'text-primary-600', label: 'In Progress' },
    not_started: { icon: CircleDashed, className: 'text-ink-faint', label: 'Not Started' },
    needs_attention: { icon: AlertTriangle, className: 'text-amber-600', label: 'Needs Attention' },
    // Nothing is locked any more; a legacy `locked` row reads as not started.
    locked: { icon: CircleDashed, className: 'text-ink-faint', label: 'Not Started' },
  };

const OPEN_PHASE_EVENT = 'audit-file:open-phase';

/**
 * Open a phase of the audit file from anywhere inside it (e.g. a completion
 * item's "Open audit work" link) and scroll to it.
 */
export function openAuditPhase(phaseKey: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_PHASE_EVENT, { detail: phaseKey }));
}

/** Distinct legend entries in professional-file order. */
const LEGEND: AuditPhaseState[] = ['complete', 'in_progress', 'not_started', 'needs_attention'];

export function AuditFileNav({
  engagementId,
  panelKeys = [],
  renderPhase,
}: {
  engagementId: string;
  /** Phase / tracker keys that have a workspace to expand. */
  panelKeys?: readonly string[];
  /** The workspace for an expanded phase, rendered directly under its row. */
  renderPhase?: (phaseKey: string) => ReactNode;
}): JSX.Element | null {
  const query = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit'],
    queryFn: () =>
      apiFetch<StatutoryAuditWorkflow[]>(`/engagements/${engagementId}/statutory-audit`),
  });
  // Several phases may be open at once; each collapses independently.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const key = (e as CustomEvent<string>).detail;
      if (!panelKeys.includes(key)) return;
      setOpen((prev) => new Set(prev).add(key));
      requestAnimationFrame(() =>
        document
          .getElementById(`audit-phase-${key}`)
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
      );
    };
    window.addEventListener(OPEN_PHASE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PHASE_EVENT, onOpen);
  }, [panelKeys]);

  // Silent when there is no audit file — this section is additive to Work.
  if (!query.data || query.data.length === 0) return null;

  const row = (
    key: string,
    label: ReactNode,
    lead: ReactNode,
    icon: ReactNode,
    title: string,
  ): JSX.Element => {
    const expandable = Boolean(renderPhase) && panelKeys.includes(key);
    const isOpen = expandable && open.has(key);
    return (
      <li key={key} id={`audit-phase-${key}`}>
        <button
          type="button"
          disabled={!expandable}
          aria-expanded={expandable ? isOpen : undefined}
          onClick={expandable ? () => toggle(key) : undefined}
          className={`group flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
            isOpen ? 'bg-surface-sunken' : 'bg-transparent'
          } ${expandable ? 'hover:bg-surface-sunken' : 'cursor-default'}`}
          title={title}
        >
          {lead}
          {icon}
          <span className="flex-1 text-ink">{label}</span>
          {expandable && <ExpandToggle open={isOpen} />}
        </button>
        {isOpen && (
          <div className="border-t border-line bg-surface px-4 py-4">{renderPhase!(key)}</div>
        )}
      </li>
    );
  };

  const TRACKERS: Array<[string, string, LucideIcon, string]> = [
    ['pbc', 'PBC — Client Information', ClipboardList, 'PBC — Client Information Tracker'],
    ['review', 'Review', ClipboardCheck, 'Review — pending reviews and review notes'],
    ['team', 'Team', Users, 'Team — people, workload and time'],
    ['reassessment', 'Reassessment', RefreshCw, 'Change impact & reassessment'],
  ];

  return (
    <>
      {query.data.map((wf) => (
        <Card key={wf.workflowInstanceId} className="mb-4 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line bg-surface-raised/70 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold text-ink">Audit File</h2>
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                Statutory Audit · {wf.templateVersion}
              </p>
            </div>
          </div>

          <ol className="divide-y divide-line">
            {wf.phases.map((phase) => {
              const meta = STATE_META[phase.state];
              const Icon = meta.icon;
              return row(
                phase.phaseKey,
                phase.title,
                <span className="w-6 shrink-0 font-mono text-xs text-ink-faint">
                  {String(phase.phaseNo).padStart(2, '0')}
                </span>,
                <Icon className={`h-4 w-4 shrink-0 ${meta.className}`} aria-hidden />,
                meta.label,
              );
            })}
          </ol>

          {/* PBC (§16), Review (§25), Team (§24) and Reassessment are
              cross-cutting layers over the whole file, not one of the ten file
              phases; they expand the same way below the phase tree. */}
          {renderPhase && (
            <ol className="divide-y divide-line border-t border-line">
              {TRACKERS.map(([key, label, TrackerIcon, title]) =>
                row(
                  key,
                  label,
                  <span className="w-6 shrink-0" />,
                  <TrackerIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />,
                  title,
                ),
              )}
            </ol>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line bg-surface-raised/40 px-4 py-2 text-[11px] text-ink-faint">
            {LEGEND.map((state) => {
              const meta = STATE_META[state];
              const Icon = meta.icon;
              return (
                <span key={state} className="inline-flex items-center gap-1">
                  <Icon className={`h-3 w-3 ${meta.className}`} aria-hidden />
                  {meta.label}
                </span>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}
