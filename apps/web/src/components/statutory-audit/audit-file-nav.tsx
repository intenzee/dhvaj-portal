'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  Lock,
  Users,
  AlertTriangle,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import type { AuditPhaseState, StatutoryAuditWorkflow } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { Card } from '@/components/ui';

/**
 * The Work-tab left audit-file navigation (Audit Spec §8, §10) — the versioned
 * workflow shell's ten phases with professional state. It is an expandable
 * professional-file tree, NOT a flat task list. Renders nothing when the
 * engagement carries no statutory-audit service, so non-audit engagements are
 * unaffected.
 *
 * Selecting a phase is wired in later SA phases (Framework, Planning, …); for now
 * this establishes the file skeleton and communicates stage at a glance.
 */

const STATE_META: Record<
  AuditPhaseState,
  { icon: LucideIcon; className: string; label: string }
> = {
  complete: { icon: CheckCircle2, className: 'text-emerald-600', label: 'Complete' },
  in_progress: { icon: CircleDot, className: 'text-primary-600', label: 'In Progress' },
  not_started: { icon: CircleDashed, className: 'text-ink-faint', label: 'Not Started' },
  needs_attention: { icon: AlertTriangle, className: 'text-amber-600', label: 'Needs Attention' },
  locked: { icon: Lock, className: 'text-ink-faint/70', label: 'Locked' },
};

/** Distinct legend entries in professional-file order. */
const LEGEND: AuditPhaseState[] = [
  'complete',
  'in_progress',
  'not_started',
  'needs_attention',
  'locked',
];

export function AuditFileNav({
  engagementId,
  selectedPhaseKey,
  onSelectPhase,
}: {
  engagementId: string;
  selectedPhaseKey?: string;
  onSelectPhase?: (phaseKey: string) => void;
}): JSX.Element | null {
  const query = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit'],
    queryFn: () => apiFetch<StatutoryAuditWorkflow[]>(`/engagements/${engagementId}/statutory-audit`),
  });

  // Silent when there is no audit file — this section is additive to Work.
  if (!query.data || query.data.length === 0) return null;

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
              const isSelected = selectedPhaseKey === phase.phaseKey;
              const clickable = Boolean(onSelectPhase) && phase.state !== 'locked';
              return (
                <li key={phase.id}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={clickable ? () => onSelectPhase!(phase.phaseKey) : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                      isSelected ? 'bg-surface-sunken' : 'bg-transparent'
                    } ${clickable ? 'hover:bg-surface-sunken' : 'cursor-default'} ${
                      phase.state === 'locked' ? 'opacity-70' : ''
                    }`}
                    title={`${meta.label}${phase.state === 'locked' ? ' — unlocks after its predecessor is approved' : ''}`}
                  >
                    <span className="w-6 shrink-0 font-mono text-xs text-ink-faint">
                      {String(phase.phaseNo).padStart(2, '0')}
                    </span>
                    <Icon className={`h-4 w-4 shrink-0 ${meta.className}`} aria-hidden />
                    <span className={`flex-1 ${phase.state === 'locked' ? 'text-ink-muted' : 'text-ink'}`}>
                      {phase.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* PBC — Master Client Information Tracker (§16). A cross-cutting
              client-request layer, not one of the ten file phases; surfaced as a
              first-class tracker below the phase tree. */}
          {onSelectPhase && (
            <div className="border-t border-line">
              <button
                type="button"
                onClick={() => onSelectPhase('pbc')}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-sunken ${
                  selectedPhaseKey === 'pbc' ? 'bg-surface-sunken' : 'bg-transparent'
                }`}
                title="PBC — Client Information Tracker"
              >
                <span className="w-6 shrink-0" />
                <ClipboardList className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
                <span className="flex-1 text-ink">PBC — Client Information</span>
              </button>
            </div>
          )}

          {/* Review — first-class review control (§25) and Team — people, workload
              and time (§24). Cross-cutting layers over the whole file, not one of
              the ten file phases; surfaced as trackers below the phase tree. */}
          {onSelectPhase && (
            <div className="border-t border-line">
              <button
                type="button"
                onClick={() => onSelectPhase('review')}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-sunken ${
                  selectedPhaseKey === 'review' ? 'bg-surface-sunken' : 'bg-transparent'
                }`}
                title="Review — pending reviews and review notes"
              >
                <span className="w-6 shrink-0" />
                <ClipboardCheck className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
                <span className="flex-1 text-ink">Review</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectPhase('team')}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-sunken ${
                  selectedPhaseKey === 'team' ? 'bg-surface-sunken' : 'bg-transparent'
                }`}
                title="Team — people, workload and time"
              >
                <span className="w-6 shrink-0" />
                <Users className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
                <span className="flex-1 text-ink">Team</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectPhase('reassessment')}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-sunken ${
                  selectedPhaseKey === 'reassessment' ? 'bg-surface-sunken' : 'bg-transparent'
                }`}
                title="Change impact & reassessment"
              >
                <span className="w-6 shrink-0" />
                <RefreshCw className="h-4 w-4 shrink-0 text-primary-600" aria-hidden />
                <span className="flex-1 text-ink">Reassessment</span>
              </button>
            </div>
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
