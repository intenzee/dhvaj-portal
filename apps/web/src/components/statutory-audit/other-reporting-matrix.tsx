'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  OTHER_REPORTING_REFERENCE_CONTEXT,
  REPORTING_APPLICABILITIES,
  REPORTING_APPLICABILITY_LABEL,
  REPORTING_CARD_GROUP,
  REPORTING_CARD_GROUP_LABEL,
  REPORTING_STATUSES,
  REPORTING_STATUS_LABEL,
  REPORTING_WORK_CONFIGURED_LABEL,
  REPORTING_WORK_STATUSES,
  REPORTING_WORK_STATUS_LABEL,
  type ReportingApplicability,
  type ReportingCard,
  type ReportingCardGroup,
  type ReportingStatus,
  type ReportingWorkStatus,
  type StatutoryAuditOtherReporting,
  type UpdateReportingCardInput,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { FrameworkReferences } from './framework-references';
import { ReportingCardEvidence } from './other-reporting-evidence';
import { ApplicabilityBadge, Fact, ReportingStatusBadge, type FactsPatch } from './other-reporting-ui';

/**
 * 02.7 requirement cards (spec §4, §16, §17): one card per statutory reporting
 * obligation, grouped as the final reporting matrix — applicability with its
 * source, the work source, the final conclusion stage and the system reporting
 * status. Each card opens in place (+/−) for the basis, View Provision /
 * Guidance (Authority Library context `02.7`), evidence, the team's work state
 * and an applicability override. Card work stays editable after 02.7 is
 * approved — 02.7 can be COMPLETE while cards are Work Pending (§20).
 */

const GROUP_ORDER = Object.values(REPORTING_CARD_GROUP) as ReportingCardGroup[];

export function OtherReportingMatrix({
  engagementId,
  or,
  canManage,
  factsEditable,
  onSaveFacts,
  busy,
}: {
  engagementId: string;
  or: StatutoryAuditOtherReporting;
  canManage: boolean;
  /** Applicability overrides are facts — locked once Section 02 is approved. */
  factsEditable: boolean;
  onSaveFacts: (patch: FactsPatch) => void;
  busy: boolean;
}): JSX.Element {
  const cards = or.detail?.cards ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!cards.length)
    return <p className="text-sm text-ink-muted">Run the assessment to build the matrix.</p>;

  return (
    <div className="space-y-4" data-testid="other-reporting-matrix">
      {GROUP_ORDER.map((g) => {
        const rows = cards.filter((c) => c.group === g);
        if (!rows.length) return null;
        return (
          <section key={g} aria-label={REPORTING_CARD_GROUP_LABEL[g]}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {REPORTING_CARD_GROUP_LABEL[g]}
            </h4>
            <ul className="divide-y divide-line rounded-md border border-line">
              {rows.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    aria-expanded={open === c.key}
                    onClick={() => setOpen(open === c.key ? null : c.key)}
                    className="group flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <ExpandToggle open={open === c.key} />
                    <span className="min-w-[9rem] font-medium text-ink">{c.clause}</span>
                    <span className="flex-1 text-ink-muted">{c.requirement}</span>
                    <ApplicabilityBadge value={c.applicability} />
                    <ReportingStatusBadge value={c.state.reportingStatus ?? c.systemReportingStatus} />
                    <Badge tone={c.state.workStatus === 'complete' ? 'success' : 'neutral'}>
                      {REPORTING_WORK_STATUS_LABEL[c.state.workStatus]}
                    </Badge>
                    {c.systemExceptions.length + c.state.exceptions > 0 && (
                      <Badge tone="danger">
                        {c.systemExceptions.length + c.state.exceptions} exception(s)
                      </Badge>
                    )}
                    <span className="text-xs text-ink-faint">{c.evidenceCount} linked</span>
                  </button>
                  {open === c.key && (
                    <CardDetail
                      engagementId={engagementId}
                      or={or}
                      card={c}
                      canManage={canManage}
                      factsEditable={factsEditable}
                      onSaveFacts={onSaveFacts}
                      busy={busy}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CardDetail({
  engagementId,
  or,
  card,
  canManage,
  factsEditable,
  onSaveFacts,
  busy,
}: {
  engagementId: string;
  or: StatutoryAuditOtherReporting;
  card: ReportingCard;
  canManage: boolean;
  factsEditable: boolean;
  onSaveFacts: (patch: FactsPatch) => void;
  busy: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const s = card.state;
  const [workStatus, setWorkStatus] = useState<ReportingWorkStatus>(s.workStatus);
  const [reportingStatus, setReportingStatus] = useState<ReportingStatus | ''>(
    s.reportingStatus ?? '',
  );
  const [proposed, setProposed] = useState(s.proposedConclusion ?? '');
  const [exceptions, setExceptions] = useState(String(s.exceptions));
  const [exceptionNote, setExceptionNote] = useState(s.exceptionNote ?? '');
  const [workpaper, setWorkpaper] = useState(s.sourceWorkpaper ?? '');
  const override = or.capturedFacts.applicabilityOverrides?.[card.key];
  const [ovApplicability, setOvApplicability] = useState<ReportingApplicability | ''>(
    override?.applicability ?? '',
  );
  const [ovReason, setOvReason] = useState(override?.reason ?? '');

  const save = useMutation({
    mutationFn: (body: Omit<UpdateReportingCardInput, 'version'>) =>
      apiFetch(
        `/engagements/${engagementId}/statutory-audit/${or.workflowInstanceId}/other-reporting/cards/${card.key}`,
        { method: 'POST', body: { ...body, version: s.version } },
      ),
    onSuccess: () => {
      toast('Card saved.');
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save the card.'),
  });
  const exceptionCount = Math.max(0, Math.trunc(Number(exceptions) || 0));
  const disabled = !canManage || save.isPending;

  return (
    <div className="space-y-3 border-t border-line bg-surface-sunken px-3 py-3 pl-10 text-sm">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Applicability source" value={card.applicabilitySource} />
        <Fact label="Work source" value={card.workSource} />
        <Fact label="Work configured" value={REPORTING_WORK_CONFIGURED_LABEL[card.workConfigured]} />
        <Fact label="Final conclusion stage" value={card.finalStage} />
      </dl>
      <p className="text-ink-muted">{card.applicabilityBasis}</p>
      {card.systemExceptions.length > 0 && (
        <ul className="ml-5 list-disc text-danger-700" aria-label="System exceptions">
          {card.systemExceptions.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <FrameworkReferences
        contextKey={OTHER_REPORTING_REFERENCE_CONTEXT}
        anchors={card.anchors}
        effectiveOn={or.periodStart}
      />
      <ReportingCardEvidence
        engagementId={engagementId}
        workflowInstanceId={or.workflowInstanceId}
        cardKey={card.key}
        canManage={canManage}
      />

      <div className="grid gap-3 sm:grid-cols-2" aria-label="Card work state">
        <Field label="Work status">
          <Select
            value={workStatus}
            disabled={disabled}
            onChange={(e) => setWorkStatus(e.target.value as ReportingWorkStatus)}
          >
            {REPORTING_WORK_STATUSES.map((w) => (
              <option key={w} value={w}>
                {REPORTING_WORK_STATUS_LABEL[w]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Reporting status"
          hint={`System: ${REPORTING_STATUS_LABEL[card.systemReportingStatus]}`}
        >
          <Select
            value={reportingStatus}
            disabled={disabled}
            onChange={(e) => setReportingStatus(e.target.value as ReportingStatus | '')}
          >
            <option value="">Use the system status</option>
            {REPORTING_STATUSES.map((r) => (
              <option key={r} value={r}>
                {REPORTING_STATUS_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Exceptions (team)">
          <Input
            type="number"
            min={0}
            value={exceptions}
            disabled={disabled}
            onChange={(e) => setExceptions(e.target.value)}
          />
        </Field>
        <Field label="Source workpaper">
          <Input value={workpaper} disabled={disabled} onChange={(e) => setWorkpaper(e.target.value)} />
        </Field>
        {exceptionCount > 0 && (
          <Field label="Describe the exception(s)" required className="sm:col-span-2">
            <Textarea
              rows={2}
              value={exceptionNote}
              disabled={disabled}
              onChange={(e) => setExceptionNote(e.target.value)}
            />
          </Field>
        )}
        <Field label="Proposed reporting conclusion" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={proposed}
            disabled={disabled}
            onChange={(e) => setProposed(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-xs text-ink-muted">
        {s.reviewedAt
          ? `Reviewed by ${s.reviewedByName ?? '—'} · ${formatDate(s.reviewedAt)}`
          : 'Not reviewed yet.'}
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || (exceptionCount > 0 && !exceptionNote.trim())}
            onClick={() =>
              save.mutate({
                workStatus,
                reportingStatus: reportingStatus || null,
                proposedConclusion: proposed.trim() || null,
                exceptions: exceptionCount,
                exceptionNote: exceptionCount > 0 ? exceptionNote.trim() : null,
                sourceWorkpaper: workpaper.trim() || null,
              })
            }
          >
            Save card
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => save.mutate({ reviewed: !s.reviewedAt })}
          >
            {s.reviewedAt ? 'Clear review' : 'Mark reviewed'}
          </Button>
        </div>
      )}

      {factsEditable && (
        <div className="space-y-2 rounded-md border border-line p-3" aria-label="Applicability override">
          <p className="text-xs text-ink-muted">
            Applicability override — removing an obligation the system found needs Engagement
            Partner approval.
          </p>
          <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
            <Select
              aria-label="Override applicability"
              value={ovApplicability}
              disabled={busy}
              onChange={(e) => setOvApplicability(e.target.value as ReportingApplicability | '')}
            >
              <option value="">No override (system)</option>
              {REPORTING_APPLICABILITIES.map((a) => (
                <option key={a} value={a}>
                  {REPORTING_APPLICABILITY_LABEL[a]}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Override reason"
              placeholder="Reason (mandatory for an override)"
              value={ovReason}
              disabled={busy || !ovApplicability}
              onChange={(e) => setOvReason(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || (!!ovApplicability && !ovReason.trim()) || (!ovApplicability && !override)}
            onClick={() =>
              onSaveFacts({
                applicabilityOverrides: {
                  [card.key]: ovApplicability
                    ? { applicability: ovApplicability, reason: ovReason.trim() }
                    : null,
                },
              })
            }
          >
            {ovApplicability ? 'Save override' : 'Clear override'}
          </Button>
        </div>
      )}
    </div>
  );
}
