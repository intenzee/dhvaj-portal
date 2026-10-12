'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Info, Plus, RefreshCw, RotateCcw, Search, UserPlus } from 'lucide-react';
import {
  AA01_TEXT,
  AA01_TITLE,
  AREA_ATTENTION_LABEL,
  AREA_AMOUNT_SOURCE_LABEL,
  AREA_CATEGORY_LABEL,
  AREA_COMMENT_KIND_LABEL,
  AREA_COMPLETE_BUTTON,
  AREA_CONFIRM_BUTTON,
  AREA_DISPOSITION_LABEL,
  AREA_IMPACT_KIND_LABEL,
  AREA_PERMISSION_LEVEL_LABEL,
  AREA_PERMISSION_LEVELS,
  AREA_RETURN_BUTTON,
  AREA_SECTION_STATUS_LABEL,
  AREA_SOURCE_LABEL,
  AREA_TYPE_LABEL,
  AREA_TYPE_MEANING,
  AREA_TYPES,
  ASSERTION_GROUP_LABEL,
  AUTHORITY_CATEGORY_LABEL,
  BLOCKING_AREA_COMMENT_KINDS,
  FINANCIAL_INFO_NOT_AVAILABLE,
  FINANCIAL_UNIT_LABEL,
  FINANCIAL_UNITS,
  PARTNER_AREA_COMMENT_KINDS,
  REMOVAL_REASON_CODES,
  REMOVAL_REASON_LABEL,
  REMOVAL_REASON_NEEDS_TEXT,
  REMOVAL_WARNING_TEXT,
  REMOVE_MODAL_PROMPT,
  REMOVE_MODAL_TITLE,
  type AreaCommentKind,
  type AreaDisplayAttention,
  type AreaPermissionLevel,
  type AreaReviewComment,
  type AreaSectionStatus,
  type AreaType,
  type AssertionGroup,
  type AuditAreaReviewSummary,
  type EngagementAuditArea,
  type FinancialUnit,
  type RemovalReasonCode,
  MAP_CONTROLS_STRATEGY_LABEL,
  MAP_EVIDENCE_LABEL,
  MAP_TIMING_LABEL,
  SPECIAL_CONSIDERATION_LABEL,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Modal } from '@/components/modal';
import { SectionLauncher } from './section-launcher';
import { PlanningEvidence } from './planning-evidence';
import { PlanningGovernanceProvider, type PlanningGovernance } from './planning-governance';

/**
 * 03.5 Audit Areas & Assertions (DHVAJ 03.5 — FROZEN). The complete applicable
 * DHVAJ Audit Area Library is populated once, all Retained; the Manager removes
 * what is not required, adds what is missing and reviews the suggested SA 315
 * assertions. Attention is Standard / Enhanced Attention / Requires Review only
 * — never a risk rating. The matrix feeds 03.6 as structured data.
 *
 * Who may do what follows the §5 role matrix the API returns (`summary.access`):
 * the Manager (or a manager-equivalent grantee) prepares and completes, a
 * granted Senior / Article prepares, the Engagement Partner reviews, anyone on
 * the team may ask for a missing area. The UI only hides what would be refused.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const num = (v: number | null, unit: FinancialUnit | null) =>
  v === null ? '—' : `${v.toLocaleString('en-IN')}${unit ? ` ${FINANCIAL_UNIT_LABEL[unit]}` : ''}`;
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

const STATUS_TONE: Record<AreaSectionStatus, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  requires_review: 'danger',
  complete: 'success',
  update_required: 'warn',
};
const ATTENTION_TONE: Record<AreaDisplayAttention, string> = {
  standard: 'neutral',
  enhanced: 'warn',
  requires_review: 'danger',
};

type Filter = 'all' | 'retained' | 'enhanced' | 'removed' | 'requires_review';
type Tab = 'areas' | 'signals' | 'matrix' | 'review' | 'complete';
type Post = (path: string, body: unknown, done: string, after?: () => void, method?: 'POST' | 'DELETE') => void;

export function AuditAreasPanel({
  engagementId,
  workflowInstanceId,
  team,
  sectionOpen,
  onChanged,
}: {
  engagementId: string;
  workflowInstanceId: string;
  team: TeamMember[];
  /** Section 03 is unlocked (02.8 §14); within it the §5 role matrix decides. */
  sectionOpen: boolean;
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab | null>(null);
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/audit-areas`;
  const qk = ['engagement', engagementId, 'audit-areas', workflowInstanceId];
  const summary = useQuery({ queryKey: qk, queryFn: () => apiFetch<AuditAreaReviewSummary>(base) });
  const mutation = useMutation({
    mutationFn: (v: { path: string; body: unknown; done: string; after?: () => void; method?: 'POST' | 'DELETE' }) =>
      apiFetch<AuditAreaReviewSummary>(`${base}${v.path}`, {
        method: v.method ?? 'POST',
        body: v.method === 'DELETE' ? undefined : v.body,
      }),
    onSuccess: (data, v) => {
      // Fresh summary from the response — no refetch of the same query.
      qc.setQueryData(qk, data);
      toast(v.done);
      v.after?.();
      onChanged();
    },
    onError: (e) => toast(errMsg(e, 'Could not save 03.5.')),
  });
  const post: Post = (path, body, done, after, method) => mutation.mutate({ path, body, done, after, method });

  // §3 — first entry by someone who may prepare creates the population once (idempotent server-side).
  const populated = useRef(false);
  const s = summary.data;
  const mayPrepare = sectionOpen && !!s?.access.capabilities.prepare;
  useEffect(() => {
    if (s && s.status === 'not_started' && mayPrepare && !populated.current) {
      populated.current = true;
      post('/populate', {}, 'Applicable Audit Area Library populated — all areas Retained.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.status, mayPrepare]);

  if (summary.isLoading) return <Spinner label="Loading 03.5…" />;
  if (!s) return <p className="text-sm text-ink-muted">03.5 is unavailable.</p>;
  if (!s.record) {
    return (
      <Card className="p-3 text-sm text-ink-muted">
        {mayPrepare
          ? 'Populating the applicable DHVAJ Audit Area Library…'
          : '03.5 has not been started. The Engagement Manager populates the applicable Audit Area Library on first entry.'}
      </Card>
    );
  }
  const r = s.record;
  const caps = s.access.capabilities;
  const canEdit = r.status === 'in_progress' && s.status !== 'update_required' && mayPrepare;
  /** Complete AA-01, refresh the library, resolve Requires Review: Manager / manager-equivalent. */
  const canComplete = canEdit && caps.complete;
  const canReopen = sectionOpen && caps.complete && r.status !== 'in_progress';
  const failing = s.validations.filter((v) => !v.met).length;
  // 03.5 evidence (§28) rides the shared planning-evidence panel; adding needs the 03.5 prepare right.
  const gov: PlanningGovernance = {
    view: null,
    engagementId,
    base: `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}`,
    can: (c) => c === 'addFacts' && canEdit,
    has: (c) => c === 'addFacts' && canEdit,
    refresh: () => void qc.invalidateQueries({ queryKey: qk }),
  };

  const sections: [Tab, string][] = [
        ['areas', `Audit Areas (${s.areas.length})`],
        ['signals', `Signals & specific materiality`],
        ['matrix', `Matrix (${s.matrix.length})`],
        ['review', s.openReviewItems ? `Review & requests (${s.openReviewItems} open)` : 'Review & requests'],
        ['complete', failing ? `Completeness (${failing} to resolve)` : 'Completeness'],
      ];

  return (
    <PlanningGovernanceProvider value={gov}>
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Audit Areas &amp; Assertions</h3>
          <p className="text-sm text-ink-muted">
            Review the complete applicable Audit Area Library, remove areas not required for this engagement, add any
            missing area and confirm relevant assertions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[s.status]}>
            {r.versionLabel} · {AREA_SECTION_STATUS_LABEL[s.status]}
          </Badge>
          <span className="text-xs text-ink-muted">
            Library {r.libraryVersion} · {s.profile.frf === 'ind_as' ? 'Ind AS' : s.profile.frf === 'as' ? 'AS' : 'FRF not concluded'}
            {s.profile.cfsApplicable ? ' · CFS' : ''}
            {s.profile.initialAudit ? ' · Initial audit' : ''}
            {s.materiality ? ` · Materiality ${s.materiality.versionLabel}` : ' · Materiality not complete'}
          </span>
          <Badge tone="neutral">
            {s.access.roleLabel}
            {s.access.grant ? ` · ${AREA_PERMISSION_LEVEL_LABEL[s.access.grant]}` : ''}
          </Badge>
          {s.scopeApproachStatus !== 'complete' && (
            <span className="text-xs text-warning-700">03.4 Scope &amp; Approach is not complete yet.</span>
          )}
        </div>

        {s.methodologyUpdateAvailable && (
          <Card className="flex flex-wrap items-center justify-between gap-2 border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
            <span className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Methodology update available — library {s.currentLibraryVersion} (this engagement uses {r.libraryVersion}).
              Nothing changes until a controlled refresh; new or withdrawn areas are then flagged Requires Review.
            </span>
            {canComplete && (
              <Button
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() => post('/methodology-update', {}, 'Methodology refreshed — review the flagged areas.')}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Apply controlled refresh
              </Button>
            )}
          </Card>
        )}
        {(s.status === 'update_required' || r.status === 'complete') && (
          <ReopenBanner s={s} canReopen={canReopen} pending={mutation.isPending} post={post} />
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ['Applicable Library Areas', s.tiles.applicableLibraryAreas],
              ['Retained', s.tiles.retained],
              ['Removed', s.tiles.removed],
              ['Enhanced Attention', s.tiles.enhanced],
              ['Requires Review', s.tiles.requiresReview],
            ] as [string, number][]
          ).map(([t, v]) => (
            <Card key={t} className="p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t}</div>
              <div className="text-lg font-semibold text-ink">{v}</div>
            </Card>
          ))}
        </div>

        <SectionLauncher sections={sections} open={tab} onToggle={setTab} context="03.5 Audit Areas & Assertions">
          {tab === 'areas' && <AreasTab s={s} canEdit={canEdit} post={post} pending={mutation.isPending} team={team} />}
          {tab === 'signals' && <SignalsTab s={s} canEdit={canEdit} post={post} pending={mutation.isPending} />}
          {tab === 'matrix' && <MatrixTab s={s} />}
          {tab === 'review' && (
            <ReviewTab s={s} sectionOpen={sectionOpen} post={post} pending={mutation.isPending} />
          )}
          {tab === 'complete' && <CompleteTab s={s} canEdit={canComplete} post={post} pending={mutation.isPending} />}
        </SectionLauncher>
      </div>
    </PlanningGovernanceProvider>
  );
}

// ── Banners ──────────────────────────────────────────────────────────────────

function ReopenBanner({
  s,
  canReopen,
  pending,
  post,
}: {
  s: AuditAreaReviewSummary;
  canReopen: boolean;
  pending: boolean;
  post: Post;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const r = s.record!;
  const updateRequired = s.status === 'update_required';
  return (
    <Card
      className={`space-y-2 p-3 text-sm ${updateRequired ? 'border-warning-200 bg-warning-50 text-warning-800' : 'border-success-200'}`}
    >
      {updateRequired ? (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Update Required — upstream information changed after completion.</div>
            <ul className="mt-1 list-disc pl-4">
              {s.impacts.map((i) => (
                <li key={i.key}>
                  <span className="font-medium">{AREA_IMPACT_KIND_LABEL[i.kind]}:</span> {i.message}
                </li>
              ))}
              {!s.impacts.length && r.updateReason && <li>{r.updateReason}</li>}
            </ul>
            <p className="mt-1">Nothing was changed automatically. Reopen 03.5 to review; the impacted areas carry Requires Review.</p>
          </div>
        </div>
      ) : (
        <p className="text-ink-muted">
          {r.versionLabel} is complete{r.completedByName ? ` (${r.completedByName})` : ''}. The matrix snapshot is
          immutable — reopening creates the next 03.5 version on re-completion.
        </p>
      )}
      {canReopen && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Input placeholder="Reason for reopening…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            variant="secondary"
            disabled={pending || !reason.trim()}
            onClick={() => post('/reopen', { reason }, `03.5 reopened as v${r.versionNo + 1}.`)}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Reopen 03.5
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Landing: filters + table ────────────────────────────────────────────────

function AreasTab({
  s,
  canEdit,
  post,
  pending,
  team,
}: {
  s: AuditAreaReviewSummary;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  team: TeamMember[];
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return s.areas.filter((a) => {
      if (filter === 'retained' && a.disposition !== 'retained') return false;
      if (filter === 'removed' && a.disposition !== 'removed') return false;
      if (filter === 'enhanced' && !(a.disposition === 'retained' && a.displayAttention === 'enhanced')) return false;
      if (filter === 'requires_review' && a.displayAttention !== 'requires_review') return false;
      if (!term) return true;
      return [a.areaName, ...a.aliases].some((x) => x.toLowerCase().includes(term));
    });
  }, [s.areas, filter, q]);
  const removing = s.areas.find((a) => a.id === removeId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['all', 'All'],
            ['retained', 'Retained'],
            ['enhanced', 'Enhanced Attention'],
            ['removed', 'Removed'],
            ['requires_review', 'Requires Review'],
          ] as [Filter, string][]
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full px-2.5 py-1 text-xs ${filter === k ? 'bg-primary-600 text-white' : 'bg-surface-raised text-ink-muted hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
        <div className="relative ml-auto min-w-[14rem]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-ink-faint" />
          <Input className="pl-8" placeholder="Search area or alias…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canEdit && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Audit Area
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-left text-xs text-ink-muted">
            <tr>
              <th className="px-2 py-1.5">Audit Area</th>
              <th className="px-2 py-1.5">Information Available</th>
              <th className="px-2 py-1.5">Attention</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <AreaRow
                key={a.id}
                a={a}
                s={s}
                open={openId === a.id}
                onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                onRemove={() => setRemoveId(a.id)}
                canEdit={canEdit}
                post={post}
                pending={pending}
                team={team}
              />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-center text-ink-muted">
                  No Audit Areas match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {removing && (
        <RemoveModal a={removing} s={s} onClose={() => setRemoveId(null)} post={post} pending={pending} />
      )}
      {adding && <AddModal s={s} onClose={() => setAdding(false)} post={post} pending={pending} />}
    </div>
  );
}

function AreaRow({
  a,
  s,
  open,
  onToggle,
  onRemove,
  canEdit,
  post,
  pending,
  team,
}: {
  a: EngagementAuditArea;
  s: AuditAreaReviewSummary;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  team: TeamMember[];
}): JSX.Element {
  return (
    <>
      <tr className={`border-t border-line ${a.disposition === 'removed' ? 'text-ink-faint' : ''}`}>
        <td className="px-2 py-1.5">
          <span className={a.disposition === 'removed' ? 'line-through' : 'font-medium text-ink'}>{a.areaName}</span>
          {a.source === 'custom' && <span className="ml-1.5 text-[11px] text-primary-700">Custom</span>}
          {a.priorYear && <span className="ml-1.5 text-[11px] text-ink-faint">PY</span>}
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1">
            {a.indicators.map((i) => (
              <span key={i.key} title={i.detail} className="rounded bg-surface-raised px-1.5 py-0.5 text-[11px] text-ink-muted">
                {i.label}
              </span>
            ))}
          </div>
        </td>
        <td className="px-2 py-1.5">
          <Badge tone={ATTENTION_TONE[a.displayAttention]}>{AREA_ATTENTION_LABEL[a.displayAttention]}</Badge>
        </td>
        <td className="px-2 py-1.5">{AREA_DISPOSITION_LABEL[a.disposition]}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right">
          <button type="button" className="text-xs text-primary-700 hover:underline" onClick={onToggle}>
            {open ? 'Close' : 'Open'}
          </button>
          {canEdit && a.disposition === 'retained' && (
            <button type="button" className="ml-2 text-xs text-danger-700 hover:underline" onClick={onRemove}>
              Remove
            </button>
          )}
          {canEdit && a.disposition === 'removed' && (
            <button
              type="button"
              className="ml-2 text-xs text-primary-700 hover:underline"
              disabled={pending}
              onClick={() => post(`/areas/${a.id}/restore`, { version: a.version }, `${a.areaName} restored.`)}
            >
              Restore
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-line bg-surface-sunken/40">
          <td colSpan={5} className="p-3">
            <AreaDetail a={a} s={s} canEdit={canEdit} post={post} pending={pending} onRemove={onRemove} team={team} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── §12 detail screen (blocks A–G) ─────────────────────────────────────────

function AreaDetail({
  a,
  s,
  canEdit,
  post,
  pending,
  onRemove,
  team,
}: {
  a: EngagementAuditArea;
  s: AuditAreaReviewSummary;
  canEdit: boolean;
  post: Post;
  pending: boolean;
  onRemove: () => void;
  team: TeamMember[];
}): JSX.Element {
  const edit = canEdit && a.disposition === 'retained';
  const path = `/areas/${a.id}`;
  const [attReason, setAttReason] = useState('');
  const [amount, setAmount] = useState({
    cy: a.manualAmount?.cy?.toString() ?? '',
    py: a.manualAmount?.py?.toString() ?? '',
    currency: a.manualAmount?.currency ?? 'INR',
    unit: (a.manualAmount?.unit ?? s.datasetUnit ?? 'inr_crore') as FinancialUnit,
    source: (a.amountSource === 'other' ? 'other' : 'manual') as 'manual' | 'other',
    note: a.amountNote ?? '',
  });
  const [showAmount, setShowAmount] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [resolution, setResolution] = useState(a.inconsistencyResolution ?? '');
  const [reasonFor, setReasonFor] = useState<{ assertionId: string; kind: 'remove' | 'downgrade' } | null>(null);
  const [reason, setReason] = useState('');
  const [addAssertion, setAddAssertion] = useState('');
  const [linkSignal, setLinkSignal] = useState('');
  const [linkSpecific, setLinkSpecific] = useState('');
  const groups = (['transactions', 'balances', 'presentation'] as AssertionGroup[])
    .map((g) => ({ g, items: a.assertions.filter((x) => x.group === g) }))
    .filter((x) => x.items.length);
  const missing = s.assertionMaster.filter((m) => !a.assertions.some((x) => x.assertionId === m.id && x.active));
  const needsResolution =
    a.disposition === 'removed' &&
    ((s.profile.cfsApplicable && (a.conditionKey === 'cfs_applicable' || a.areaCode === 'CONSOL')) ||
      (s.profile.initialAudit && (a.conditionKey === 'initial_audit' || a.areaCode === 'OB')));
  const downgradeNeedsReason = a.suggestedAttention === 'enhanced';
  const linkedSignalIds = new Set(a.signals.filter((l) => l.active).map((l) => l.signalId));

  return (
    <div className="space-y-3">
      {/* A — header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{a.areaName}</span>
        <Badge tone={a.disposition === 'retained' ? 'info' : 'neutral'}>{AREA_DISPOSITION_LABEL[a.disposition]}</Badge>
        <Badge tone={ATTENTION_TONE[a.displayAttention]}>{AREA_ATTENTION_LABEL[a.displayAttention]}</Badge>
        <span className="text-xs text-ink-muted">
          {AREA_TYPE_LABEL[a.areaType]}
          {a.category ? ` · ${AREA_CATEGORY_LABEL[a.category]}` : ''} · {AREA_SOURCE_LABEL[a.source]}
          {a.areaCode ? ` ${a.areaCode}` : ''}
        </span>
        {a.additionReason && <span className="text-xs text-ink-muted">Added: {a.additionReason}</span>}
      </div>
      {a.disposition === 'removed' && (
        <p className="text-xs text-ink-muted">
          Removed{a.removedByName ? ` by ${a.removedByName}` : ''} — {a.removalReasonCode ? REMOVAL_REASON_LABEL[a.removalReasonCode] : ''}
          {a.coveredUnderName ? ` (covered under ${a.coveredUnderName})` : ''}
          {a.removalReasonText ? `: ${a.removalReasonText}` : ''}
        </p>
      )}
      {a.scopeStrategy && (
        <div className="rounded bg-surface-raised px-2 py-1.5 text-xs">
          <span className="font-medium text-ink">03.4 strategy</span>{' '}
          <span className="font-mono text-ink-faint">{a.scopeStrategy.code}</span>{' '}
          <span className="text-ink-muted">
            {[
              a.scopeStrategy.controlsStrategy && (MAP_CONTROLS_STRATEGY_LABEL as Record<string, string>)[a.scopeStrategy.controlsStrategy],
              a.scopeStrategy.timing && (MAP_TIMING_LABEL as Record<string, string>)[a.scopeStrategy.timing],
              a.scopeStrategy.evidenceChannels.map((x) => (MAP_EVIDENCE_LABEL as Record<string, string>)[x] ?? x).join(', '),
              a.scopeStrategy.specialConsiderations.map((x) => (SPECIAL_CONSIDERATION_LABEL as Record<string, string>)[x] ?? x).join(', '),
            ]
              .filter(Boolean)
              .join(' · ') || 'Not yet set in 03.4'}
          </span>
          {a.scopeStrategy.reassessmentRequired && <Badge tone="danger" className="ml-2">03.4 reassessment required</Badge>}
        </div>
      )}
      {edit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Attention">
            <Select
              value={a.attention}
              onChange={(e) => {
                const v = e.target.value as 'standard' | 'enhanced';
                if (v === 'standard' && downgradeNeedsReason && !attReason.trim()) {
                  setAttReason(' ');
                  return;
                }
                post(path, { attention: v, attentionReason: attReason.trim() || null, version: a.version }, 'Attention updated.');
              }}
            >
              <option value="standard">Standard</option>
              <option value="enhanced">Enhanced Attention</option>
            </Select>
          </Field>
          {downgradeNeedsReason && a.attention === 'enhanced' && (
            <div className="flex min-w-[18rem] flex-1 items-end gap-2">
              <Field label="Reason to downgrade to Standard" hint={`Portal suggestion: ${a.suggestionBasis ?? ''}`}>
                <Input value={attReason} onChange={(e) => setAttReason(e.target.value)} />
              </Field>
              <Button
                variant="secondary"
                disabled={pending || !attReason.trim()}
                onClick={() =>
                  post(path, { attention: 'standard', attentionReason: attReason, version: a.version }, 'Attention downgraded.')
                }
              >
                Downgrade
              </Button>
            </div>
          )}
          <Field label="Planning owner (optional)">
            <Select
              value={a.planningOwnerEmployeeId ?? ''}
              onChange={(e) =>
                post(path, { planningOwnerEmployeeId: e.target.value || null, version: a.version }, 'Owner updated.')
              }
            >
              <option value="">—</option>
              {team.map((t) => (
                <option key={t.employeeId} value={t.employeeId}>
                  {t.employeeName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      {a.attentionReason && <p className="text-xs text-ink-muted">Attention reason: {a.attentionReason}</p>}

      {/* B — financial information */}
      <Card className="space-y-1.5 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Financial information</div>
        {a.cyAmount === null && a.pyAmount === null ? (
          <p className="text-sm text-ink-muted">{FINANCIAL_INFO_NOT_AVAILABLE}</p>
        ) : (
          <p className="text-sm">
            CY {num(a.cyAmount, a.unit)} · PY {num(a.pyAmount, a.unit)}
            <span className="ml-2 text-xs text-ink-muted">
              Source: {a.amountSource ? AREA_AMOUNT_SOURCE_LABEL[a.amountSource] : '—'}
              {a.amountNote ? ` (${a.amountNote})` : ''}
            </span>
            {a.omComparison && (
              <span className="ml-2 text-xs text-ink-muted">
                {a.omComparison === 'above_om' ? 'Above OM' : 'Below OM'} — informational only
              </span>
            )}
          </p>
        )}
        {edit && !showAmount && (
          <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => setShowAmount(true)}>
            {a.manualAmount ? 'Edit balance' : 'Enter Balance'}
          </button>
        )}
        {edit && showAmount && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="CY">
              <Input type="number" value={amount.cy} onChange={(e) => setAmount({ ...amount, cy: e.target.value })} />
            </Field>
            <Field label="PY">
              <Input type="number" value={amount.py} onChange={(e) => setAmount({ ...amount, py: e.target.value })} />
            </Field>
            <Field label="Currency">
              <Input value={amount.currency} onChange={(e) => setAmount({ ...amount, currency: e.target.value })} />
            </Field>
            <Field label="Unit">
              <Select value={amount.unit} onChange={(e) => setAmount({ ...amount, unit: e.target.value as FinancialUnit })}>
                {FINANCIAL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {FINANCIAL_UNIT_LABEL[u]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source">
              <Select
                value={amount.source}
                onChange={(e) => setAmount({ ...amount, source: e.target.value as 'manual' | 'other' })}
              >
                <option value="manual">Manual entry</option>
                <option value="other">Other source</option>
              </Select>
            </Field>
            <Field label="Source note">
              <Input value={amount.note} onChange={(e) => setAmount({ ...amount, note: e.target.value })} />
            </Field>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                post(
                  path,
                  {
                    cyAmount: numOrNull(amount.cy),
                    pyAmount: numOrNull(amount.py),
                    currency: amount.currency,
                    unit: amount.unit,
                    amountSource: amount.source,
                    amountNote: amount.note || null,
                    version: a.version,
                  },
                  'Balance saved.',
                  () => setShowAmount(false),
                )
              }
            >
              Save balance
            </Button>
            {a.manualAmount && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => post(path, { amountSource: null, version: a.version }, 'Manual balance cleared.')}
              >
                Clear
              </Button>
            )}
          </div>
        )}
        {a.priorYear?.inPriorMatrix && (
          <p className="text-xs text-ink-muted">
            Prior year (reference only): {a.priorYear.retained ? 'Retained' : 'Removed'}
            {a.priorYear.attention ? ` · ${AREA_ATTENTION_LABEL[a.priorYear.attention]}` : ''}
            {a.priorYear.assertions.length ? ` · ${a.priorYear.assertions.join(', ')}` : ''}
            {a.priorYear.cy !== null ? ` · CY then ${a.priorYear.cy.toLocaleString('en-IN')}` : ''}
          </p>
        )}
        {a.priorYear && a.priorYear.matters.length > 0 && (
          <div className="text-xs text-warning-800">
            <div className="font-medium">Prior-year matters pointing at this area (03.1):</div>
            <ul className="list-disc pl-4">
              {a.priorYear.matters.map((m) => (
                <li key={m.id}>
                  <span className="font-mono">{m.code}</span> {m.matterType} — {m.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* C — why attention is highlighted */}
      {(a.suggestionBasis || a.requiresReviewReasons.length > 0 || a.warnings.some((w) => w.severity === 'high')) && (
        <Card className="space-y-1.5 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Why attention is highlighted</div>
          {a.suggestionBasis && <p className="text-sm">Portal suggestion: {a.suggestionBasis}</p>}
          {a.requiresReviewReasons.map((x) => (
            <p key={x} className="flex items-start gap-1.5 text-sm text-danger-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {x}
            </p>
          ))}
          {a.warnings
            .filter((w) => w.severity === 'high')
            .map((w) => (
              <p key={w.key} className="text-sm text-warning-800">
                {w.text}
              </p>
            ))}
          {canEdit && s.access.capabilities.complete && a.reviewFlag && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[18rem] flex-1">
                <Field label="How was this resolved?">
                  <Input value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={pending || !flagNote.trim()}
                onClick={() => post(path, { resolveReviewFlag: flagNote, version: a.version }, 'Requires Review resolved.')}
              >
                Resolve
              </Button>
            </div>
          )}
          {canEdit && needsResolution && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[18rem] flex-1">
                <Field label="Explicit resolution of the framework inconsistency">
                  <Textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={pending || !resolution.trim()}
                onClick={() =>
                  post(path, { inconsistencyResolution: resolution, version: a.version }, 'Resolution recorded.')
                }
              >
                Record resolution
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* D — relevant assertions */}
      <Card className="space-y-2 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Relevant Assertions</div>
        {!a.assertions.some((x) => x.active) && (
          <p className="text-sm text-danger-700">No active assertion — a retained area needs at least one (VAL-03).</p>
        )}
        {groups.map(({ g, items }) => (
          <div key={g}>
            <div className="text-xs text-ink-muted">{ASSERTION_GROUP_LABEL[g]}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {items.map((x) => (
                <span
                  key={x.assertionId}
                  title={[x.suggestionBasis, x.removalReason ? `Removed: ${x.removalReason}` : null, x.attentionReason]
                    .filter(Boolean)
                    .join(' · ')}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
                    !x.active
                      ? 'border-line text-ink-faint line-through'
                      : x.attention === 'enhanced'
                        ? 'border-warning-300 bg-warning-50 text-warning-800'
                        : 'border-line text-ink'
                  }`}
                >
                  {x.label}
                  {x.active && x.attention === 'enhanced' ? ' ★' : ''}
                  <span className="text-[10px] text-ink-faint">{x.assertionId}</span>
                  {edit && x.active && (
                    <>
                      <button
                        type="button"
                        className="text-[10px] text-primary-700"
                        onClick={() =>
                          x.attention === 'enhanced' && x.suggestedAttention === 'enhanced'
                            ? setReasonFor({ assertionId: x.assertionId, kind: 'downgrade' })
                            : post(
                                `${path}/assertions/${x.assertionId}`,
                                { action: 'set_attention', attention: x.attention === 'enhanced' ? 'standard' : 'enhanced' },
                                'Assertion attention updated.',
                              )
                        }
                      >
                        {x.attention === 'enhanced' ? 'Standard' : 'Enhance'}
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-danger-700"
                        onClick={() =>
                          x.origin === 'suggested'
                            ? setReasonFor({ assertionId: x.assertionId, kind: 'remove' })
                            : post(`${path}/assertions/${x.assertionId}`, { action: 'remove' }, 'Assertion removed.')
                        }
                      >
                        ✕
                      </button>
                    </>
                  )}
                  {edit && !x.active && (
                    <button
                      type="button"
                      className="text-[10px] text-primary-700"
                      onClick={() => post(`${path}/assertions/${x.assertionId}`, { action: 'restore' }, 'Assertion restored.')}
                    >
                      Restore
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
        {reasonFor && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[18rem] flex-1">
              <Field
                label={
                  reasonFor.kind === 'remove'
                    ? `Reason for removing suggested assertion ${reasonFor.assertionId}`
                    : `Reason for downgrading ${reasonFor.assertionId} to Standard`
                }
              >
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <Button
              variant="secondary"
              disabled={pending || !reason.trim()}
              onClick={() =>
                post(
                  `${path}/assertions/${reasonFor.assertionId}`,
                  reasonFor.kind === 'remove'
                    ? { action: 'remove', reason }
                    : { action: 'set_attention', attention: 'standard', reason },
                  reasonFor.kind === 'remove' ? 'Assertion removed.' : 'Assertion set to Standard.',
                  () => {
                    setReasonFor(null);
                    setReason('');
                  },
                )
              }
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
          </div>
        )}
        {edit && missing.length > 0 && (
          <div className="flex items-end gap-2">
            <Field label="Add assertion (canonical master)">
              <Select value={addAssertion} onChange={(e) => setAddAssertion(e.target.value)}>
                <option value="">Select…</option>
                {missing.map((m) => (
                  <option key={m.id} value={m.id}>
                    {ASSERTION_GROUP_LABEL[m.group]} — {m.label} ({m.id})
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              disabled={pending || !addAssertion}
              onClick={() =>
                post(`${path}/assertions/${addAssertion}`, { action: 'add' }, 'Assertion added.', () => setAddAssertion(''))
              }
            >
              Add
            </Button>
          </div>
        )}
      </Card>

      {/* E — planning signals + specific materiality */}
      <Card className="space-y-2 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Planning Signals</div>
        {a.signals.filter((l) => l.active).length === 0 && <p className="text-sm text-ink-muted">No linked signal.</p>}
        {a.signals
          .filter((l) => l.active)
          .map((l) => (
            <div key={l.signalId} className="flex items-start justify-between gap-2 text-sm">
              <span>
                <span className="font-mono text-xs">{l.code}</span> {l.observation}{' '}
                <span className="text-xs text-ink-muted">
                  ({l.attention === 'immediate_partner' ? 'Immediate Partner Attention' : l.attention === 'enhanced' ? 'Enhanced' : 'Standard'}
                  {l.origin === 'auto' ? ', auto-linked' : ''})
                </span>
              </span>
              {edit && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-danger-700 hover:underline"
                  onClick={() => post(`${path}/links`, { action: 'unlink', signalId: l.signalId }, 'Signal link removed.')}
                >
                  Remove Link
                </button>
              )}
            </div>
          ))}
        {edit &&
          a.suggestedSignals.map((x) => (
            <div key={x.signalId} className="flex items-start justify-between gap-2 text-sm text-ink-muted">
              <span>
                Suggested: <span className="font-mono text-xs">{x.code}</span> {x.observation}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-primary-700 hover:underline"
                onClick={() => post(`${path}/links`, { action: 'link', signalId: x.signalId }, `${x.code} linked.`)}
              >
                Link
              </button>
            </div>
          ))}
        {edit && (
          <div className="flex items-end gap-2">
            <Field label="+ Link Signal">
              <Select value={linkSignal} onChange={(e) => setLinkSignal(e.target.value)}>
                <option value="">Select a Planning Signal…</option>
                {s.signals
                  .filter((x) => !linkedSignalIds.has(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} — {x.observation.slice(0, 80)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              disabled={pending || !linkSignal}
              onClick={() =>
                post(`${path}/links`, { action: 'link', signalId: linkSignal }, 'Signal linked.', () => setLinkSignal(''))
              }
            >
              Link
            </Button>
          </div>
        )}
        {(s.specificMatters.length > 0 || a.specific.length > 0) && (
          <div className="border-t border-line pt-2">
            <div className="text-xs text-ink-muted">Specific materiality (03.3)</div>
            {a.specific
              .filter((l) => l.active)
              .map((l) => (
                <div key={l.specificKey} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {l.label}
                    {!l.current && <span className="ml-1 text-xs text-ink-faint">(no longer in force)</span>}
                  </span>
                  {edit && (
                    <button
                      type="button"
                      className="text-xs text-danger-700 hover:underline"
                      onClick={() => post(`${path}/links`, { action: 'unlink', specificKey: l.specificKey }, 'Unmapped.')}
                    >
                      Remove Link
                    </button>
                  )}
                </div>
              ))}
            {edit &&
              a.suggestedSpecific.map((x) => (
                <div key={x.specificKey} className="flex items-center justify-between gap-2 text-sm text-ink-muted">
                  <span>Suggested: {x.label}</span>
                  <button
                    type="button"
                    className="text-xs text-primary-700 hover:underline"
                    onClick={() => post(`${path}/links`, { action: 'link', specificKey: x.specificKey }, 'Mapped.')}
                  >
                    Map
                  </button>
                </div>
              ))}
            {edit && s.specificMatters.length > 0 && (
              <div className="mt-1 flex items-end gap-2">
                <Select value={linkSpecific} onChange={(e) => setLinkSpecific(e.target.value)}>
                  <option value="">Map a specific-materiality matter…</option>
                  {s.specificMatters
                    .filter((m) => !a.specific.some((l) => l.active && l.specificKey === m.key))
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                </Select>
                <Button
                  variant="secondary"
                  disabled={pending || !linkSpecific}
                  onClick={() =>
                    post(`${path}/links`, { action: 'link', specificKey: linkSpecific }, 'Mapped.', () => setLinkSpecific(''))
                  }
                >
                  Map
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Evidence (§28) and downstream use (§24) */}
      <Card className="space-y-1.5 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Supporting Evidence &amp; Downstream Use</div>
        {a.downstreamDetail.risks + a.downstreamDetail.procedures + a.downstreamDetail.workAreas > 0 ? (
          <p className="text-xs text-ink-muted">
            Referenced downstream: {a.downstreamDetail.risks} risk{a.downstreamDetail.risks === 1 ? '' : 's'} ·{' '}
            {a.downstreamDetail.procedures} procedure{a.downstreamDetail.procedures === 1 ? '' : 's'} started ·{' '}
            {a.downstreamDetail.workAreas} work area{a.downstreamDetail.workAreas === 1 ? '' : 's'} started — the
            area cannot be removed while these remain.
          </p>
        ) : (
          <p className="text-xs text-ink-muted">Not yet referenced by risk assessment or audit work.</p>
        )}
        <PlanningEvidence targetType="audit_area" targetId={a.id} count={a.evidenceCount} />
        {a.disposition === 'retained' && a.assertions.some((x) => x.active) && (
          <AssertionEvidence a={a} counts={s.assertionEvidenceCounts} />
        )}
      </Card>

      {/* F — professional framework */}
      {a.disposition === 'retained' && a.authorities.length > 0 && (
        <Card className="space-y-1.5 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Relevant Professional Framework</div>
          {(['accounting', 'auditing', 'companies_act_caro', 'schedule_iii', 'other'] as const).map((c) => {
            const refs = a.authorities.filter((x) => x.category === c);
            if (!refs.length) return null;
            return (
              <div key={c} className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="w-44 text-xs text-ink-muted">{AUTHORITY_CATEGORY_LABEL[c]}</span>
                {refs.map((x) => (
                  <span
                    key={x.code}
                    title={x.title}
                    className="inline-flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-[11px] text-ink-muted"
                  >
                    <BookOpen className="h-3 w-3" />
                    {x.label}
                  </span>
                ))}
              </div>
            );
          })}
        </Card>
      )}

      {/* G — actions */}
      {canEdit && (
        <div className="flex gap-2">
          {a.disposition === 'retained' ? (
            <Button variant="secondary" onClick={onRemove}>
              Remove Area
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => post(`${path}/restore`, { version: a.version }, `${a.areaName} restored.`)}
            >
              Restore
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** §28 — supporting schedules per assertion, opened on demand to keep the detail light. */
function AssertionEvidence({
  a,
  counts,
}: {
  a: EngagementAuditArea;
  counts: Record<string, number>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const active = a.assertions.filter((x) => x.active);
  const total = active.reduce((n, x) => n + (counts[x.id] ?? 0), 0);
  return (
    <div>
      <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? '−' : '+'} Evidence per assertion{total ? ` (${total})` : ''}
      </button>
      {open && (
        <div className="mt-1 space-y-1 pl-3">
          {active.map((x) => (
            <div key={x.id} className="flex flex-wrap items-start gap-2 text-sm">
              <span className="w-56 shrink-0 pt-1.5 text-xs text-ink-muted">
                {x.label} <span className="text-ink-faint">({x.assertionId})</span>
              </span>
              <div className="min-w-0 flex-1">
                <PlanningEvidence targetType="area_assertion" targetId={x.id} count={counts[x.id] ?? 0} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── §9.1 Remove modal ──────────────────────────────────────────────────────

function RemoveModal({
  a,
  s,
  onClose,
  post,
  pending,
}: {
  a: EngagementAuditArea;
  s: AuditAreaReviewSummary;
  onClose: () => void;
  post: Post;
  pending: boolean;
}): JSX.Element {
  const [code, setCode] = useState<RemovalReasonCode | ''>('');
  const [text, setText] = useState('');
  const [covered, setCovered] = useState('');
  const textNeeded = (code && REMOVAL_REASON_NEEDS_TEXT.includes(code)) || a.warnings.length > 0;
  const ok = !!code && (!textNeeded || !!text.trim()) && (code !== 'COVERED_ELSEWHERE' || !!covered);
  return (
    <Modal
      open
      onClose={onClose}
      title={REMOVE_MODAL_TITLE}
      description={REMOVE_MODAL_PROMPT}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !ok}
            onClick={() =>
              post(
                `/areas/${a.id}/remove`,
                {
                  reasonCode: code,
                  reasonText: text.trim() || null,
                  coveredUnderAreaId: code === 'COVERED_ELSEWHERE' ? covered : null,
                  version: a.version,
                },
                `${a.areaName} removed.`,
                onClose,
              )
            }
          >
            Remove
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink">{a.areaName}</p>
        {a.warnings.length > 0 && (
          <Card className="space-y-1 border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
            <p className="font-medium">{REMOVAL_WARNING_TEXT}</p>
            <ul className="list-disc pl-4">
              {a.warnings.map((w) => (
                <li key={w.key} className={w.severity === 'high' ? 'font-medium' : ''}>
                  {w.text}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Field label="Removal reason">
          <Select value={code} onChange={(e) => setCode(e.target.value as RemovalReasonCode)}>
            <option value="">Select…</option>
            {REMOVAL_REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {REMOVAL_REASON_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        {code === 'COVERED_ELSEWHERE' && (
          <Field label="Covered under (retained Audit Area)">
            <Select value={covered} onChange={(e) => setCovered(e.target.value)}>
              <option value="">Select…</option>
              {s.areas
                .filter((x) => x.id !== a.id && x.disposition === 'retained')
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.areaName}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field
          label={textNeeded ? 'Rationale (required)' : 'Supporting note (optional)'}
          hint={a.strongIndicators.length ? `Strong indicators: ${a.strongIndicators.join('; ')}` : undefined}
        >
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ── §11 Add modal (exactly two options) ─────────────────────────────────────

function AddModal({
  s,
  onClose,
  post,
  pending,
}: {
  s: AuditAreaReviewSummary;
  onClose: () => void;
  post: Post;
  pending: boolean;
}): JSX.Element {
  const [mode, setMode] = useState<'library' | 'custom'>('library');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState<{ name: string; areaType: AreaType | ''; reason: string; signalIds: string[] }>({
    name: '',
    areaType: '',
    reason: '',
    signalIds: [],
  });
  const removed = s.areas.filter((a) => a.disposition === 'removed' && a.source === 'library');
  const term = q.trim().toLowerCase();
  const lib = s.availableLibrary.filter(
    (l) => !term || [l.areaName, ...l.aliases].some((x) => x.toLowerCase().includes(term)),
  );
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Add Audit Area"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {mode === 'library' ? (
            <Button
              disabled={pending || !picked.length}
              onClick={() => post('/library', { libraryAreaIds: picked }, `${picked.length} area(s) added as Retained.`, onClose)}
            >
              Add as Retained
            </Button>
          ) : (
            <Button
              disabled={pending || !custom.name.trim() || !custom.areaType || !custom.reason.trim()}
              onClick={() => post('/custom', custom, 'Custom Audit Area added.', onClose)}
            >
              Add custom area
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          {(
            [
              ['library', 'From DHVAJ Library'],
              ['custom', 'Custom Audit Area'],
            ] as const
          ).map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`rounded px-3 py-1.5 text-sm ${mode === k ? 'bg-primary-600 text-white' : 'bg-surface-raised text-ink-muted'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {mode === 'library' ? (
          <div className="space-y-2">
            <Input placeholder="Search library areas…" value={q} onChange={(e) => setQ(e.target.value)} />
            {!lib.length && <p className="text-sm text-ink-muted">Every library area is already in this engagement.</p>}
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {lib.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(l.id)}
                    onChange={(e) =>
                      setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))
                    }
                  />
                  {l.areaName}
                  <span className="text-xs text-ink-faint">
                    {l.areaCode} · {AREA_TYPE_LABEL[l.areaType]} · {l.libraryVersion}
                  </span>
                </label>
              ))}
            </div>
            {removed.length > 0 && (
              <p className="text-xs text-ink-muted">
                Already present but Removed (use Restore in the list): {removed.map((a) => a.areaName).join(', ')}.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Audit Area Name">
              <Input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            </Field>
            <Field
              label="Area Type"
              hint={custom.areaType ? AREA_TYPE_MEANING[custom.areaType] : undefined}
            >
              <Select value={custom.areaType} onChange={(e) => setCustom({ ...custom, areaType: e.target.value as AreaType })}>
                <option value="">Select…</option>
                {AREA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {AREA_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason for Addition">
              <Textarea rows={2} value={custom.reason} onChange={(e) => setCustom({ ...custom, reason: e.target.value })} />
            </Field>
            <Field label="Related Planning Signal(s) (optional)">
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {s.signals.map((x) => (
                  <label key={x.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={custom.signalIds.includes(x.id)}
                      onChange={(e) =>
                        setCustom({
                          ...custom,
                          signalIds: e.target.checked
                            ? [...custom.signalIds, x.id]
                            : custom.signalIds.filter((y) => y !== x.id),
                        })
                      }
                    />
                    <span className="font-mono text-xs">{x.code}</span> {x.observation.slice(0, 90)}
                  </label>
                ))}
              </div>
            </Field>
            <p className="text-xs text-ink-muted">
              Engagement-only — not added to the firm master library. Add its assertions after creating it.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Signals & specific materiality (VAL-04 / VAL-05) ────────────────────────

function SignalsTab({
  s,
  canEdit,
  post,
  pending,
}: {
  s: AuditAreaReviewSummary;
  canEdit: boolean;
  post: Post;
  pending: boolean;
}): JSX.Element {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const name = (id: string) => s.areas.find((a) => a.id === id)?.areaName ?? id;
  const high = s.signals.filter((x) => x.requiresMapping);
  const other = s.signals.filter((x) => !x.requiresMapping);
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Enhanced / Immediate Planning Signals (VAL-05)</div>
        <p className="text-xs text-ink-muted">
          Each must map to at least one retained Audit Area or carry a documented “no Audit Area mapping required”
          resolution. 03.5 does not create risks from signals — it only establishes area / assertion relevance.
        </p>
        {!high.length && <p className="text-sm text-ink-muted">None.</p>}
        {high.map((x) => (
          <div key={x.id} className="space-y-1 border-t border-line pt-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{x.code}</span>
              <span>{x.observation}</span>
              <Badge tone={x.mappedAreaIds.length || x.resolution ? 'success' : 'danger'}>
                {x.mappedAreaIds.length ? `Mapped: ${x.mappedAreaIds.map(name).join(', ')}` : x.resolution ? 'No-area resolution' : 'Unmapped'}
              </Badge>
            </div>
            {x.resolution && <p className="text-xs text-ink-muted">Resolution: {x.resolution}</p>}
            {canEdit && !x.mappedAreaIds.length && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[18rem] flex-1">
                  <Input
                    placeholder="No Audit Area mapping required because…"
                    value={notes[x.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [x.id]: e.target.value })}
                  />
                </div>
                <Button
                  variant="secondary"
                  disabled={pending || !(notes[x.id] ?? '').trim()}
                  onClick={() => post('/signal-resolutions', { signalId: x.id, note: notes[x.id] }, 'Resolution recorded.')}
                >
                  Record resolution
                </Button>
                {x.resolution && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => post('/signal-resolutions', { signalId: x.id, note: null }, 'Resolution cleared.')}
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
      <Card className="space-y-2 p-3">
        <div className="text-sm font-medium text-ink">Specific materiality (VAL-04)</div>
        {!s.specificMatters.length && (
          <p className="text-sm text-ink-muted">No specific materiality in the materiality in force.</p>
        )}
        {s.specificMatters.map((m) => (
          <div key={m.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{m.label}</span>
            <Badge tone={m.mappedAreaIds.length ? 'success' : 'danger'}>
              {m.mappedAreaIds.length ? m.mappedAreaIds.map(name).join(', ') : 'Not mapped to a retained area'}
            </Badge>
          </div>
        ))}
        <p className="text-xs text-ink-muted">Map a matter from the area’s detail (Planning Signals block).</p>
      </Card>
      {other.length > 0 && (
        <Card className="space-y-1 p-3">
          <div className="text-sm font-medium text-ink">Other Planning Signals</div>
          {other.map((x) => (
            <div key={x.id} className="text-sm text-ink-muted">
              <span className="font-mono text-xs">{x.code}</span> {x.observation}
              {x.mappedAreaIds.length ? ` — ${x.mappedAreaIds.map(name).join(', ')}` : ''}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── §23 Matrix ──────────────────────────────────────────────────────────────

function MatrixTable({ rows }: { rows: AuditAreaReviewSummary['matrix'] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-left text-xs text-ink-muted">
          <tr>
            <th className="px-2 py-1.5">Audit Area</th>
            <th className="px-2 py-1.5">CY</th>
            <th className="px-2 py-1.5">PY</th>
            <th className="px-2 py-1.5">Attention</th>
            <th className="px-2 py-1.5">Relevant Assertions</th>
            <th className="px-2 py-1.5">Planning Signals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.areaId} className="border-t border-line align-top">
              <td className="px-2 py-1.5 font-medium text-ink">{m.areaName}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{m.cy === null ? '' : num(m.cy, m.unit)}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{m.py === null ? '' : num(m.py, m.unit)}</td>
              <td className="px-2 py-1.5">{m.attention === 'enhanced' ? 'Enhanced' : 'Standard'}</td>
              <td className="px-2 py-1.5">
                {m.assertions.map((x, i) => (
                  <span key={x.assertionId} className={x.attention === 'enhanced' ? 'font-semibold text-warning-800' : ''}>
                    {i ? '; ' : ''}
                    {x.label}
                    {x.attention === 'enhanced' ? ' ★' : ''}
                  </span>
                ))}
              </td>
              <td className="px-2 py-1.5">{m.signals.map((x) => x.code).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTab({ s }: { s: AuditAreaReviewSummary }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Generated automatically from the retained areas and active assertions (★ = Enhanced Attention). This is the
        structured population 03.6 consumes — no separate preparation step.
      </p>
      <MatrixTable rows={s.matrix} />
      {s.matrixVersions.length > 0 && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">Completed matrix versions (immutable)</div>
          {s.matrixVersions.map((v) => (
            <div key={v.versionNo} className="space-y-2 border-t border-line pt-2 text-sm">
              <button
                type="button"
                className="text-primary-700 hover:underline"
                onClick={() => setOpen(open === v.versionNo ? null : v.versionNo)}
              >
                {v.versionLabel} — {new Date(v.confirmedAt).toLocaleString('en-IN')}
                {v.confirmedByName ? ` · ${v.confirmedByName}` : ''} · library {v.libraryVersion} · {v.rows.length} areas
              </button>
              {open === v.versionNo && <MatrixTable rows={v.rows} />}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── §27 Partner review · §25 downstream requests · §5 permissions ───────────

function ReviewTab({
  s,
  sectionOpen,
  post,
  pending,
}: {
  s: AuditAreaReviewSummary;
  sectionOpen: boolean;
  post: Post;
  pending: boolean;
}): JSX.Element {
  const caps = s.access.capabilities;
  /** The EP raises any review kind; a preparer may leave a plain review comment. */
  const kinds: AreaCommentKind[] = !sectionOpen
    ? []
    : caps.partnerReview
      ? PARTNER_AREA_COMMENT_KINDS
      : caps.prepare
        ? ['comment']
        : [];
  const [kind, setKind] = useState<AreaCommentKind>('comment');
  const [areaId, setAreaId] = useState('');
  const [body, setBody] = useState('');
  const open = s.comments.filter((c) => c.status === 'open');
  const closed = s.comments.filter((c) => c.status !== 'open');
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        The Engagement Partner may view, comment, challenge and request reassessment; the risk assessment may ask for an
        area that is missing. Open challenges, reassessment requests and area requests must be answered before AA-01
        (VAL-09). Formal planning approval remains in 03.12.
      </p>
      {open.length === 0 && closed.length === 0 && <p className="text-sm text-ink-muted">No review items yet.</p>}
      {[...open, ...closed].map((c) => (
        <ReviewItem key={c.id} c={c} s={s} canRespond={sectionOpen && caps.respond} post={post} pending={pending} />
      ))}
      {kinds.length > 0 && (
        <Card className="space-y-2 p-3">
          <div className="text-sm font-medium text-ink">
            {caps.partnerReview ? 'Engagement Partner review' : 'Review comment'}
          </div>
          <div className="flex flex-wrap gap-2">
            {kinds.length > 1 && (
              <Field label="Type">
                <Select value={kind} onChange={(e) => setKind(e.target.value as AreaCommentKind)}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {AREA_COMMENT_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Audit Area (optional)">
              <Select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">Whole section</option>
                {s.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.areaName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Comment…" />
          <Button
            variant="secondary"
            disabled={pending || !body.trim()}
            onClick={() =>
              post(
                '/comments',
                { kind: kinds.includes(kind) ? kind : 'comment', body, areaId: areaId || null },
                `${AREA_COMMENT_KIND_LABEL[kinds.includes(kind) ? kind : 'comment']} recorded.`,
                () => {
                  setBody('');
                  setAreaId('');
                },
              )
            }
          >
            Add
          </Button>
        </Card>
      )}
      {sectionOpen && caps.requestArea && <AreaRequestForm post={post} pending={pending} />}
      <GrantsCard s={s} canManage={sectionOpen && caps.manageGrants} post={post} pending={pending} />
    </div>
  );
}

function ReviewItem({
  c,
  s,
  canRespond,
  post,
  pending,
}: {
  c: AreaReviewComment;
  s: AuditAreaReviewSummary;
  canRespond: boolean;
  post: Post;
  pending: boolean;
}): JSX.Element {
  const [response, setResponse] = useState('');
  const [resolvedAreaId, setResolvedAreaId] = useState('');
  const blocking = BLOCKING_AREA_COMMENT_KINDS.includes(c.kind);
  const resolvedArea = c.resolvedAreaId ? s.areas.find((a) => a.id === c.resolvedAreaId) : null;
  const retained = s.areas.filter((a) => a.disposition === 'retained');
  return (
    <Card className="space-y-1 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.status === 'open' ? (blocking ? 'warn' : 'info') : 'success'}>
          {AREA_COMMENT_KIND_LABEL[c.kind]}
          {c.status === 'open' ? '' : ' · answered'}
        </Badge>
        {c.areaName && <span className="text-xs text-ink-muted">{c.areaName}</span>}
        {c.kind === 'downstream_request' && (
          <span className="text-xs text-ink-muted">
            from {c.sourceModule === 'section_04' ? 'Section 04 risk register' : '03.6 risk assessment'}
          </span>
        )}
        <span className="text-xs text-ink-faint">
          {c.createdByName ?? ''} · {new Date(c.createdAt).toLocaleString('en-IN')}
        </span>
      </div>
      {c.proposedAreaName && (
        <p className="font-medium text-ink">Area requested: {c.proposedAreaName}</p>
      )}
      <p>{c.body}</p>
      {c.response && (
        <p className="text-ink-muted">
          Response{c.respondedByName ? ` (${c.respondedByName})` : ''}: {c.response}
          {resolvedArea ? ` — answered by ${resolvedArea.areaName}` : ''}
        </p>
      )}
      {canRespond && c.status === 'open' && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Input placeholder="Response…" value={response} onChange={(e) => setResponse(e.target.value)} />
          </div>
          {c.kind === 'downstream_request' && (
            <Field label="Answered by area (add or restore it first)">
              <Select value={resolvedAreaId} onChange={(e) => setResolvedAreaId(e.target.value)}>
                <option value="">No area — explain in the response</option>
                {retained.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.areaName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button
            variant="secondary"
            disabled={pending || !response.trim()}
            onClick={() =>
              post(
                `/comments/${c.id}`,
                { response, resolvedAreaId: c.kind === 'downstream_request' ? resolvedAreaId || null : undefined },
                'Response recorded.',
              )
            }
          >
            Respond
          </Button>
        </div>
      )}
    </Card>
  );
}

/** §25 — the risk work needs an area the retained population does not have. */
function AreaRequestForm({ post, pending }: { post: Post; pending: boolean }): JSX.Element {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Card className="space-y-2 p-3">
      <div className="text-sm font-medium text-ink">Request a missing Audit Area</div>
      <p className="text-xs text-ink-muted">
        Use this when risk assessment needs an area that is not retained. The Manager adds or restores it (or explains
        why not); nothing is created automatically.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Area needed">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="min-w-[16rem] flex-1">
          <Field label="Why it is needed">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <Button
          variant="secondary"
          disabled={pending || !name.trim() || !reason.trim()}
          onClick={() =>
            post('/requests', { proposedAreaName: name, reason }, 'Area request sent to the Manager.', () => {
              setName('');
              setReason('');
            })
          }
        >
          Send request
        </Button>
      </div>
    </Card>
  );
}

/** §5 — the Manager grants Seniors / Articles the right to prepare (or complete) 03.5. */
function GrantsCard({
  s,
  canManage,
  post,
  pending,
}: {
  s: AuditAreaReviewSummary;
  canManage: boolean;
  post: Post;
  pending: boolean;
}): JSX.Element | null {
  const [employeeId, setEmployeeId] = useState('');
  const [level, setLevel] = useState<AreaPermissionLevel>('prepare');
  const [note, setNote] = useState('');
  if (!canManage && s.grants.length === 0) return null;
  const candidates = s.grantCandidates.filter((c) => !s.grants.some((g) => g.employeeId === c.employeeId));
  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <UserPlus className="h-4 w-4" /> 03.5 permissions
      </div>
      {s.grants.length === 0 ? (
        <p className="text-xs text-ink-muted">Only the Engagement Manager prepares 03.5 until a permission is granted.</p>
      ) : (
        <ul className="space-y-1">
          {s.grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {g.employeeName ?? 'Team member'} — {AREA_PERMISSION_LEVEL_LABEL[g.level]}
                <span className="ml-1 text-xs text-ink-faint">
                  {g.grantedByName ? `by ${g.grantedByName}, ` : ''}
                  {new Date(g.grantedAt).toLocaleDateString('en-IN')}
                  {g.note ? ` · ${g.note}` : ''}
                </span>
              </span>
              {canManage && (
                <button
                  type="button"
                  className="text-xs text-danger-700 hover:underline"
                  disabled={pending}
                  onClick={() => post(`/permissions/${g.id}`, null, 'Permission revoked.', undefined, 'DELETE')}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
          <Field label="Team member">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {candidates.map((c) => (
                <option key={c.employeeId} value={c.employeeId}>
                  {c.name} ({c.roleOnEngagement})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Permission">
            <Select value={level} onChange={(e) => setLevel(e.target.value as AreaPermissionLevel)}>
              {AREA_PERMISSION_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {AREA_PERMISSION_LEVEL_LABEL[l]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="min-w-[12rem] flex-1">
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <Button
            variant="secondary"
            disabled={pending || !employeeId}
            onClick={() =>
              post('/permissions', { employeeId, level, note: note.trim() || null }, 'Permission granted.', () => {
                setEmployeeId('');
                setNote('');
              })
            }
          >
            Grant
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── §21 / §22 Completeness + AA-01 ──────────────────────────────────────────

function CompleteTab({
  s,
  canEdit,
  post,
  pending,
}: {
  s: AuditAreaReviewSummary;
  canEdit: boolean;
  post: Post;
  pending: boolean;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const allPass = s.validations.every((v) => v.met);
  const c = s.completeness;
  const metrics: [string, number | string][] = [
    ['Library Areas Reviewed', c.libraryAreasReviewed],
    ['Retained', c.retained],
    ['Removed', c.removed],
    ['Custom Areas Added', `${c.customRetained + c.customRemoved} (${c.customRetained} retained, ${c.customRemoved} removed)`],
    ['Enhanced Attention', c.enhanced],
    ['Requires Review', c.requiresReview],
    ['Unresolved Planning Signals', c.unresolvedSignals],
  ];
  return (
    <div className="space-y-3">
      <Card className="space-y-1 p-3">
        <div className="text-sm font-medium text-ink">Completeness and validation checks</div>
        {s.validations.map((v) => (
          <div key={v.id} className="flex items-start gap-2 text-sm">
            <span className={v.met ? 'text-success-700' : 'text-danger-700'}>{v.met ? '✓' : '✗'}</span>
            <span className="w-16 shrink-0 font-mono text-xs text-ink-muted">{v.id}</span>
            <span>
              {v.label}
              {v.detail && <span className="block text-xs text-danger-700">{v.detail}</span>}
            </span>
          </div>
        ))}
      </Card>
      {canEdit && (
        <Button disabled={pending} onClick={() => setConfirming(true)}>
          {AREA_COMPLETE_BUTTON}
        </Button>
      )}
      {confirming && (
        <Modal
          open
          onClose={() => setConfirming(false)}
          title="Audit Area Completeness Review"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {AREA_RETURN_BUTTON}
              </Button>
              <Button
                disabled={pending || !allPass}
                onClick={() =>
                  post(
                    '/complete',
                    { confirm: true, version: s.record!.version },
                    '03.5 complete — Audit Area & Assertion Matrix generated.',
                    () => setConfirming(false),
                  )
                }
              >
                {AREA_CONFIRM_BUTTON}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <table className="w-full text-sm">
              <tbody>
                {metrics.map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1 text-ink-muted">{k}</td>
                    <td className="py-1 text-right font-medium">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!allPass && (
              <p className="text-sm text-danger-700">
                Confirm &amp; Complete is enabled only when VAL-01 to VAL-11 pass —{' '}
                {s.validations
                  .filter((v) => !v.met)
                  .map((v) => v.id)
                  .join(', ')}{' '}
                outstanding.
              </p>
            )}
            <Card className="space-y-1 p-3">
              <div className="text-sm font-medium">{AA01_TITLE}</div>
              <p className="text-sm">{AA01_TEXT}</p>
            </Card>
          </div>
        </Modal>
      )}
    </div>
  );
}
