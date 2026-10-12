'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import {
  DECISION_STATUS_LABEL,
  DEPENDENCY_OWNER_PARTY_LABEL,
  DEPENDENCY_STATUS_LABEL,
  NEEDED_BY_LABEL,
  OTHER_AUDITOR_STRATEGY_LABEL,
  ROLL_FORWARD_LABEL,
  SCOPE_CONCLUSION_LABEL,
  SCOPE_HANDOFF_ITEMS,
  SCOPE_STATUS_LABEL,
  SPECIALIST_DECISION_LABEL,
  UNIT_AUDITOR_LABEL,
  type ScopeHandoff,
  type ScopeHandoffItem,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { Badge, Card } from '@/components/ui';
import { openAuditPhase } from './audit-file-nav';

export const isScopeHandoffItem = (key: string): key is ScopeHandoffItem =>
  (SCOPE_HANDOFF_ITEMS as readonly string[]).includes(key);

const TITLE: Record<ScopeHandoffItem, string> = {
  specialist_planning: 'From 03.4 — specialists Likely Required / Evaluate Further',
  component_planning: 'From 03.4 — units audited by other auditors and the strategy',
  timeline_milestones: 'From 03.4 — timing pattern and open scope dependencies',
};

const label = (m: Record<string, string>, k: string | null | undefined) => (k ? (m[k] ?? k) : '—');

/**
 * DHVAJ 03.4 §17 / §12 / §19 / §21 hand-offs: what 03.8 (specialists), 03.9
 * (components / branches) and 03.11 (timeline) start from. Read-only — the
 * decisions are made and changed in 03.4; this module plans the detail.
 */
export function ScopeHandoffCard({
  engagementId,
  workflowInstanceId,
  itemKey,
}: {
  engagementId: string;
  workflowInstanceId: string;
  itemKey: ScopeHandoffItem;
}): JSX.Element | null {
  const q = useQuery({
    queryKey: ['engagement', engagementId, 'scope-approach', workflowInstanceId, 'handoff'],
    queryFn: () =>
      apiFetch<ScopeHandoff>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/scope-approach/handoff`,
      ),
  });
  const h = q.data;
  if (!h?.available) return null;

  const rows: { key: string; main: string; detail: string }[] =
    itemKey === 'specialist_planning'
      ? h.specialists.map((x, i) => ({
          key: `${i}`,
          main: `${x.signalCode ? `${x.signalCode} · ` : ''}${x.observation}`,
          detail: `${label(SPECIALIST_DECISION_LABEL, x.decision)}${x.note ? ` — ${x.note}` : ''}`,
        }))
      : itemKey === 'component_planning'
        ? h.components.map((x) => ({
            key: x.code,
            main: `${x.code} ${x.name} — ${label(UNIT_AUDITOR_LABEL, x.auditor)}`,
            detail:
              [
                x.auditorStrategy && label(OTHER_AUDITOR_STRATEGY_LABEL, x.auditorStrategy),
                x.scopeConclusion && `scope: ${label(SCOPE_CONCLUSION_LABEL, x.scopeConclusion)}`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Strategy and scope conclusion not yet decided in 03.4',
          }))
        : [
            ...h.timing.map((x) => ({
              key: `t-${x.label}`,
              main: x.label,
              detail: `${label(DECISION_STATUS_LABEL, x.status)}${x.rollForward ? ` · roll-forward: ${label(ROLL_FORWARD_LABEL, x.rollForward)}` : ''}${x.prompt ? ` — ${x.prompt}` : ''}`,
            })),
            ...h.dependencies.map((x) => ({
              key: x.code,
              main: `${x.code} ${x.description}`,
              detail: `needed by ${label(NEEDED_BY_LABEL, x.neededBy)} · ${label(DEPENDENCY_STATUS_LABEL, x.status)} · owner: ${x.ownerName ?? label(DEPENDENCY_OWNER_PARTY_LABEL, x.ownerParty)}`,
            })),
          ];

  return (
    <Card className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">{TITLE[itemKey]}</div>
        <div className="flex items-center gap-2">
          <Badge tone={h.status === 'complete' ? 'success' : 'info'}>
            03.4 {h.versionLabel} · {h.status ? SCOPE_STATUS_LABEL[h.status] : '—'}
          </Badge>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline"
            onClick={() => openAuditPhase('planning', 'planning-audit_approach')}
          >
            Open 03.4 <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-faint">Nothing handed over from 03.4 yet.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="text-ink">{r.main}</span>
              <span className="block text-ink-muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-ink-faint">
        Read-only — the strategic decision is made in 03.4; plan the detail here.
      </p>
    </Card>
  );
}
