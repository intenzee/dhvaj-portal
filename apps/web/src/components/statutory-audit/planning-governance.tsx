'use client';

import { createContext, useContext, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Flag,
  History,
  Lock,
  Unlock,
} from 'lucide-react';
import {
  PARTNER_ATTENTION_STATUS_LABEL,
  PLANNING_ATTENTION_LABEL,
  type AreaOfFocusRecord,
  type PartnerAttentionItem,
  type PartnerAttentionStatus,
  type PlanningCapability,
  type PlanningGovernanceView,
  type PlanningRevisionBaseline,
  type PlanningSignalRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { Field, Select, Textarea } from '@/components/form';

/**
 * 03.1 governance (DHVAJ 03.1 §10, §19, §20, §23): the acting user's role on
 * THIS engagement drives what the control room offers — the team proposes
 * signals and records facts, the Manager assesses and completes, the EP
 * reviews Immediate Partner Attention. After Planning approval (03.12) 03.1 is
 * frozen until reopened as a controlled revision. The server enforces all of
 * it; the UI only hides what would be refused.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export interface PlanningGovernance {
  view: PlanningGovernanceView | null;
  engagementId: string;
  base: string;
  /** May the caller do this now (capability, framework gate and the 03.12 lock)? */
  can: (capability: PlanningCapability) => boolean;
  /** The capability alone — for steps exempt from the 03.12 lock (EP review, reopen). */
  has: (capability: PlanningCapability) => boolean;
  refresh: () => void;
}

const NO_GOVERNANCE: PlanningGovernance = {
  view: null,
  engagementId: '',
  base: '',
  can: () => false,
  has: () => false,
  refresh: () => undefined,
};

const GovernanceContext = createContext<PlanningGovernance>(NO_GOVERNANCE);

export const PlanningGovernanceProvider = GovernanceContext.Provider;

export function usePlanningGov(): PlanningGovernance {
  return useContext(GovernanceContext);
}

/** Load the governance read and derive the caller's gates. */
export function usePlanningGovernance(
  engagementId: string,
  base: string,
  qk: string[],
  /** Section 03 is open (the Audit Framework is approved). */
  unlocked: boolean,
  refresh: () => void,
  /** False until the 03.1 summary read (which may generate the register) has landed. */
  enabled = true,
): PlanningGovernance & { isLoading: boolean } {
  const q = useQuery({
    queryKey: [...qk, 'governance'],
    queryFn: () => apiFetch<PlanningGovernanceView>(`${base}/planning-governance`),
    enabled,
  });
  const view = q.data ?? null;
  const has = (c: PlanningCapability) => unlocked && !!view?.access.capabilities[c];
  return {
    view,
    engagementId,
    base,
    has,
    can: (c) => has(c) && !view?.access.locked,
    refresh,
    isLoading: q.isLoading,
  };
}

/** "Proposed by …" on a team signal the Manager has not assessed yet. */
export function ProposalBadge({ signalId }: { signalId: string }): JSX.Element | null {
  const p = usePlanningGov().view?.proposals[signalId];
  if (!p) return null;
  return (
    <span title={`Proposed ${new Date(p.proposedAt).toLocaleString()}`}>
      <Badge tone="warn">Proposed by {p.proposedByName ?? 'the team'} — awaiting Manager</Badge>
    </span>
  );
}

// ── Strip above the control room: role, version, lock / revision, downstream ──

export function PlanningGovernanceStrip(): JSX.Element | null {
  const gov = usePlanningGov();
  const toast = useToast();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const [showBaseline, setShowBaseline] = useState(false);
  const view = gov.view;

  const reopen = useMutation({
    mutationFn: () =>
      apiFetch<PlanningGovernanceView>(`${gov.base}/planning-governance/reopen`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: (v) => {
      toast(`03.1 reopened as ${v.access.versionLabel} — the approved baseline is kept.`);
      setReopening(false);
      setReason('');
      gov.refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not reopen 03.1.'), 'error'),
  });

  if (!view) return null;
  const { access, downstreamFlags } = view;
  const open = access.openRevision;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <Badge tone={access.role === 'none' ? 'danger' : 'neutral'}>You: {access.roleLabel}</Badge>
        <Badge tone="info">03.1 {access.versionLabel}</Badge>
        {access.role === 'team' && (
          <span>
            You can propose signals and record facts and evidence; the Engagement Manager assesses
            them.
          </span>
        )}
      </div>

      {access.locked && (
        <div className="rounded-lg border border-line bg-surface-raised p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex items-start gap-1.5 text-ink">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              {access.lockReason}
            </p>
            {gov.has('reopen') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReopening((o) => !o)}
                aria-expanded={reopening}
              >
                <Unlock className="h-4 w-4" /> Reopen for revision
              </Button>
            )}
          </div>
          {reopening && (
            <div className="mt-2 space-y-2">
              <Field
                label="Why does 03.1 need to change?"
                hint={`It becomes ${nextLabel(access.versionLabel)}; the approved ${access.versionLabel} is kept as the baseline and Planning needs re-approval in 03.12.`}
                required
              >
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => reopen.mutate()}
                  disabled={reopen.isPending || !reason.trim()}
                >
                  Reopen 03.1
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReopening(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm">
          <p className="text-ink">
            <span className="font-medium">
              Controlled revision {open.fromVersionLabel} → {open.toVersionLabel}
            </span>{' '}
            — reopened by {open.openedByName ?? '—'} on{' '}
            {new Date(open.openedAt).toLocaleDateString()}: {open.reason}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Complete 03.1 again when the revision is done; Planning then needs re-approval in 03.12.
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowBaseline((o) => !o)}
            aria-expanded={showBaseline}
          >
            <History className="h-4 w-4" /> Approved baseline ({open.fromVersionLabel})
          </Button>
          {showBaseline && <RevisionBaseline revisionId={open.id} />}
        </div>
      )}

      {!open && access.revisions.length > 0 && (
        <p className="text-[11px] text-ink-faint">
          Revisions:{' '}
          {access.revisions
            .map(
              (r) =>
                `${r.fromVersionLabel} → ${r.toVersionLabel} (${r.reason}${r.completedByName ? `; completed by ${r.completedByName}` : ''})`,
            )
            .join(' · ')}
        </p>
      )}

      {downstreamFlags.length > 0 && (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm">
          <p className="flex items-start gap-1.5 font-medium text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />A 03.1 change
            needs downstream planning reassessed
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {downstreamFlags.map((f) => (
              <li key={f.itemKey}>
                <span className="font-mono text-ink-faint">{f.module}</span> {f.title} — Needs
                Attention
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function nextLabel(label: string): string {
  const m = /^v1\.(\d+)$/.exec(label);
  return m ? `v1.${Number(m[1]) + 1}` : label;
}

function RevisionBaseline({ revisionId }: { revisionId: string }): JSX.Element {
  const { base } = usePlanningGov();
  const q = useQuery({
    queryKey: ['planning-revision', base, revisionId],
    queryFn: () =>
      apiFetch<PlanningRevisionBaseline>(`${base}/planning-governance/revisions/${revisionId}`),
  });
  if (q.isLoading) return <Spinner label="Loading baseline…" />;
  if (!q.data) return <p className="text-xs text-danger-700">Could not load the baseline.</p>;
  const b = q.data.baseline as Record<string, unknown>;
  const record = (b.record ?? {}) as Record<string, unknown>;
  const count = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).length : 0);
  const signals = (Array.isArray(b.signals) ? b.signals : []) as Array<Record<string, unknown>>;
  return (
    <div className="mt-2 space-y-1 rounded-md border border-line bg-surface p-2 text-xs">
      <p className="text-ink-muted">
        {count('signals')} signal(s) · {count('focusAreas')} Area(s) of Focus · {count('changes')}{' '}
        change(s) · {count('priorYear')} prior-year matter(s) · {count('matters')} Planning
        Matter(s)
      </p>
      {typeof record.strategy_summary === 'string' && record.strategy_summary && (
        <p className="text-ink">Strategy: {record.strategy_summary}</p>
      )}
      {signals.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-ink-muted">
          {signals.map((s) => (
            <li key={String(s.id)}>
              <span className="font-mono text-ink-faint">{`PS-${String(s.seq ?? '').padStart(3, '0')}`}</span>{' '}
              {String(s.observation ?? '')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── §10 / §20 Immediate Partner Attention queue ─────────────────────────────

const STATUS_TONE: Record<PartnerAttentionStatus, string> = {
  surfaced: 'danger',
  challenged: 'warn',
  responded: 'info',
  acknowledged: 'success',
};

export function PartnerAttentionPanel({
  signals,
  focus,
}: {
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
}): JSX.Element {
  const gov = usePlanningGov();
  const [flagging, setFlagging] = useState(false);
  const view = gov.view;
  if (!view) return <Spinner label="Loading Partner Attention…" />;
  const q = view.partnerAttention;
  const queued = new Set(q.items.map((i) => i.targetId));

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Every Immediate Partner Attention signal and Partner Area of Focus is surfaced to the
        Engagement Partner{q.engagementPartnerName ? ` (${q.engagementPartnerName})` : ''}. The EP
        acknowledges or challenges each one; 03.1 completes only when all are acknowledged.
      </p>
      {q.items.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          Nothing requires Immediate Partner Attention.
        </p>
      )}
      {q.items.map((item) => (
        <AttentionCard key={`${item.id}-${item.version}`} item={item} />
      ))}
      {gov.can('partnerReview') &&
        (flagging ? (
          <FlagForm
            signals={signals.filter((s) => s.status !== 'closed' && !queued.has(s.id))}
            focus={focus.filter((f) => f.status !== 'superseded' && !queued.has(f.id))}
            onDone={() => setFlagging(false)}
          />
        ) : (
          <Button variant="ghost" onClick={() => setFlagging(true)}>
            <Flag className="mr-1.5 h-4 w-4" />
            Flag for my attention
          </Button>
        ))}
    </div>
  );
}

function AttentionCard({ item }: { item: PartnerAttentionItem }): JSX.Element {
  const gov = usePlanningGov();
  const toast = useToast();
  const [open, setOpen] = useState(item.status === 'surfaced' || item.status === 'challenged');
  const [mode, setMode] = useState<'acknowledge' | 'challenge' | 'respond' | null>(null);
  const [text, setText] = useState('');

  const act = useMutation({
    mutationFn: (step: 'acknowledge' | 'challenge' | 'respond') =>
      apiFetch<PlanningGovernanceView>(`${gov.base}/planning-attention/${item.id}/${step}`, {
        method: 'POST',
        body:
          step === 'acknowledge'
            ? { note: text || undefined, version: item.version }
            : step === 'challenge'
              ? { challenge: text, version: item.version }
              : { response: text, version: item.version },
      }),
    onSuccess: (_v, step) => {
      toast(
        step === 'acknowledge'
          ? `${item.code} acknowledged.`
          : step === 'challenge'
            ? `${item.code} challenged — the Manager has been notified.`
            : `Response sent to the Engagement Partner.`,
      );
      setMode(null);
      setText('');
      gov.refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not save.'), 'error'),
  });

  const epMay = gov.has('partnerReview') && item.status !== 'acknowledged';
  const managerMay = gov.has('respondToChallenge') && item.status === 'challenged';

  return (
    <Card className="p-3 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-start gap-2">
          {open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
          )}
          <span className="min-w-0">
            <span className="mr-2 font-mono text-xs text-ink-faint">{item.code}</span>
            <span className="text-ink">{item.title}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <Badge>
                {item.kind === 'signal'
                  ? 'Signal'
                  : item.kind === 'materiality'
                    ? '03.3 Materiality'
                    : 'Area of Focus'}
              </Badge>
              {item.raisedByPartner && <Badge tone="info">Raised by EP</Badge>}
              {item.attention && (
                <Badge tone="danger">{PLANNING_ATTENTION_LABEL[item.attention]}</Badge>
              )}
            </span>
          </span>
        </span>
        <Badge tone={STATUS_TONE[item.status]} className="shrink-0">
          {PARTNER_ATTENTION_STATUS_LABEL[item.status]}
        </Badge>
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {item.detail && <p className="text-ink-muted">{item.detail}</p>}
          {item.partnerNote && (
            <p className="text-xs text-ink-muted">EP note: {item.partnerNote}</p>
          )}
          {item.challenge && (
            <p className="text-xs text-ink">
              <span className="font-medium">EP challenge:</span> {item.challenge}
            </p>
          )}
          {item.managerResponse && (
            <p className="text-xs text-ink">
              <span className="font-medium">
                Response{item.respondedByName ? ` (${item.respondedByName})` : ''}:
              </span>{' '}
              {item.managerResponse}
            </p>
          )}
          {item.reviewedByName && item.status === 'acknowledged' && (
            <p className="text-[11px] text-ink-faint">
              Acknowledged by {item.reviewedByName}
              {item.reviewedAt ? ` on ${new Date(item.reviewedAt).toLocaleDateString()}` : ''}
            </p>
          )}

          {(epMay || managerMay) && (
            <div className="flex flex-wrap gap-2">
              {epMay && (
                <>
                  <Button
                    size="sm"
                    variant={mode === 'acknowledge' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'acknowledge' ? null : 'acknowledge')}
                    aria-expanded={mode === 'acknowledge'}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === 'challenge' ? 'primary' : 'secondary'}
                    onClick={() => setMode(mode === 'challenge' ? null : 'challenge')}
                    aria-expanded={mode === 'challenge'}
                  >
                    Challenge
                  </Button>
                </>
              )}
              {managerMay && (
                <Button
                  size="sm"
                  variant={mode === 'respond' ? 'primary' : 'secondary'}
                  onClick={() => setMode(mode === 'respond' ? null : 'respond')}
                  aria-expanded={mode === 'respond'}
                >
                  Respond to challenge
                </Button>
              )}
            </div>
          )}
          {mode && (
            <div className="space-y-2 rounded-lg bg-surface-raised p-2">
              <Field
                label={
                  mode === 'acknowledge'
                    ? 'Note (optional)'
                    : mode === 'challenge'
                      ? 'What should the Manager consider?'
                      : 'Your response to the EP'
                }
                required={mode !== 'acknowledge'}
              >
                <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <Button
                size="sm"
                onClick={() => act.mutate(mode)}
                disabled={act.isPending || (mode !== 'acknowledge' && !text.trim())}
              >
                {mode === 'acknowledge'
                  ? 'Acknowledge'
                  : mode === 'challenge'
                    ? 'Send challenge'
                    : 'Send response'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function FlagForm({
  signals,
  focus,
  onDone,
}: {
  signals: PlanningSignalRecord[];
  focus: AreaOfFocusRecord[];
  onDone: () => void;
}): JSX.Element {
  const gov = usePlanningGov();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const flag = useMutation({
    mutationFn: () => {
      const [kind, id] = target.split(':');
      return apiFetch<PlanningGovernanceView>(`${gov.base}/planning-attention/flag`, {
        method: 'POST',
        body: kind === 'signal' ? { signalId: id, note } : { focusId: id, note },
      });
    },
    onSuccess: () => {
      toast('Flagged for Immediate Partner Attention — the Manager has been notified.');
      onDone();
      gov.refresh();
    },
    onError: (e) => toast(errMsg(e, 'Could not flag.'), 'error'),
  });
  return (
    <Card className="space-y-2 p-3">
      <Field label="Signal or Area of Focus" required>
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— Select —</option>
          {signals.map((s) => (
            <option key={s.id} value={`signal:${s.id}`}>
              {s.signalCode} · {s.observation.slice(0, 90)}
            </option>
          ))}
          {focus.map((f) => (
            <option key={f.id} value={`focus:${f.id}`}>
              {f.focusCode} · {f.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Why do you want to see this?" required>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => flag.mutate()}
          disabled={flag.isPending || !target || !note.trim()}
        >
          Flag
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
