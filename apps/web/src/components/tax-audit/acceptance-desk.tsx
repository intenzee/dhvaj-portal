'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TAX_AUDIT_FORMS,
  taxAuditFormLabel,
  taxAuditRegime,
  type SaveTaxAuditAcceptanceInput,
  type TaxAuditAcceptance,
  type TaxAuditForm,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';

/**
 * Tax Audit acceptance desk (Phase 4, F-3), opened under the year's row:
 * the s.44AB independence check, the previous auditor and their written
 * communication, the form, the signing partner — only partners with a valid
 * COP and room under the firm's limit are offered, each with their count —
 * and the appointment letter. Accept moves the audit on to Information from
 * client. Only the engagement's partner or manager sees the controls.
 */
export function AcceptanceDesk({
  engagementId,
  auditId,
}: {
  engagementId: string;
  auditId: string;
}): JSX.Element {
  const url = `/engagements/${engagementId}/tax-audits/${auditId}/acceptance`;
  const key = [...TAX_AUDITS_KEY, 'acceptance', auditId];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<TaxAuditAcceptance>(url) });
  if (q.isLoading) return <Spinner label="Loading the acceptance desk…" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger-700">Could not load it.</p>;
  return <AcceptanceForm key={q.data.version} url={url} queryKey={key} a={q.data} />;
}

function AcceptanceForm({
  url,
  queryKey,
  a,
}: {
  url: string;
  queryKey: readonly unknown[];
  a: TaxAuditAcceptance;
}): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [auditorName, setAuditorName] = useState(a.previousAuditor.name ?? '');

  const done = (next: TaxAuditAcceptance, message?: string): void => {
    qc.setQueryData(queryKey, next);
    void qc.invalidateQueries({ queryKey: TAX_AUDITS_KEY });
    if (message) toast(message);
  };
  const failed = (err: unknown): void =>
    toast(err instanceof ApiError ? err.message : 'Could not save.', 'error');

  const save = useMutation({
    mutationFn: (patch: Omit<SaveTaxAuditAcceptanceInput, 'version'>) =>
      apiFetch<TaxAuditAcceptance>(url, { method: 'PUT', body: { version: a.version, ...patch } }),
    onSuccess: (next) => done(next),
    onError: failed,
  });
  const upload = useMutation({
    mutationFn: async (f: File) =>
      apiFetch<TaxAuditAcceptance>(`${url}/previous-auditor-letter`, {
        method: 'POST',
        body: {
          version: a.version,
          filename: f.name,
          contentType: f.type || undefined,
          contentBase64: await blobToBase64(f),
        },
      }),
    onSuccess: (next) => done(next, 'Letter to the previous auditor filed.'),
    onError: failed,
  });
  const letter = useMutation({
    mutationFn: () =>
      apiFetch<TaxAuditAcceptance>(`${url}/appointment-letter`, {
        method: 'POST',
        body: { version: a.version },
      }),
    onSuccess: (next) => done(next, 'Appointment letter made in the engagement’s documents.'),
    onError: failed,
  });
  const accept = useMutation({
    mutationFn: () =>
      apiFetch<TaxAuditAcceptance>(`${url}/accept`, {
        method: 'POST',
        body: { version: a.version },
      }),
    onSuccess: (next) => done(next, 'Tax audit accepted.'),
    onError: failed,
  });
  const busy = save.isPending || upload.isPending || letter.isPending || accept.isPending;
  const edit = a.canEdit;
  const offered = a.partners.filter((p) => p.offered);
  const notOffered = a.partners.filter((p) => !p.offered);
  const proposal = a.proposal;
  const proposedPartner = proposal?.signingPartnerId
    ? a.partners.find((p) => p.employeeId === proposal.signingPartnerId)
    : undefined;
  // What taking last year's choices would still fill in.
  const carry: Omit<SaveTaxAuditAcceptanceInput, 'version'> = {};
  if (proposal && !a.formType && proposal.formType) carry.formType = proposal.formType;
  if (proposal && !a.signingPartnerId && proposedPartner?.offered) {
    carry.signingPartnerId = proposedPartner.employeeId;
  }
  if (proposal && a.previousAuditor.changed === null) carry.previousAuditorChanged = false;

  return (
    <div className="space-y-4 text-sm">
      {a.acceptedAt && (
        <p className="text-ink">
          <Badge tone="success">Accepted</Badge> {formatDate(a.acceptedAt)}
          {a.acceptedByName ? ` by ${a.acceptedByName}` : ''}.
        </p>
      )}

      {proposal && (
        <section className="space-y-1" aria-label="Last year">
          <h4 className="font-medium text-ink">Rolled over from FY {proposal.fromFinancialYear}</h4>
          <p className="text-ink-muted">
            Last year:{' '}
            {[
              proposal.formType && taxAuditFormLabel(a.financialYear, proposal.formType),
              proposal.signingPartnerName && `signed by ${proposal.signingPartnerName}`,
            ]
              .filter(Boolean)
              .join(', ') || 'no form or signing partner recorded'}
            .
          </p>
          {proposal.team.length > 0 && (
            <p className="text-ink-muted">The same team carries on: {proposal.team.join(', ')}.</p>
          )}
          {edit && proposedPartner && !proposedPartner.offered && !a.signingPartnerId && (
            <p className="text-xs text-ink-faint">
              {proposedPartner.summary} — {proposedPartner.reason}
            </p>
          )}
          {edit && Object.keys(carry).length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => save.mutate(carry)}
            >
              Take last year’s choices
            </Button>
          )}
        </section>
      )}

      <section className="space-y-1">
        <h4 className="font-medium text-ink">Independence (s.44AB)</h4>
        {a.independence.ok ? (
          <p className="text-ink-muted">
            The firm does not keep this client’s books for FY {a.financialYear}.
          </p>
        ) : (
          a.independence.findings.map((f) => (
            <p key={f.message} className="text-danger-700">
              {f.message}
            </p>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Previous auditor</h4>
        {edit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Did another firm sign last year’s report?">
              <Select
                value={a.previousAuditor.changed === null ? '' : String(a.previousAuditor.changed)}
                disabled={busy}
                onChange={(e) =>
                  save.mutate({
                    previousAuditorChanged:
                      e.target.value === '' ? null : e.target.value === 'true',
                  })
                }
              >
                <option value="">Not answered</option>
                <option value="false">No — same auditor, or a first audit</option>
                <option value="true">Yes — another firm</option>
              </Select>
            </Field>
            {a.previousAuditor.changed && (
              <Field label="Previous auditor">
                <Input
                  value={auditorName}
                  maxLength={200}
                  disabled={busy}
                  onChange={(e) => setAuditorName(e.target.value)}
                  onBlur={() =>
                    auditorName.trim() !== (a.previousAuditor.name ?? '') &&
                    save.mutate({ previousAuditorName: auditorName.trim() || null })
                  }
                />
              </Field>
            )}
          </div>
        ) : (
          <p className="text-ink-muted">
            {a.previousAuditor.changed === null
              ? 'Not answered yet.'
              : a.previousAuditor.changed
                ? `Another firm: ${a.previousAuditor.name ?? '—'}.`
                : 'No change of auditor.'}
          </p>
        )}
        {a.previousAuditor.changed && (
          <div className="flex flex-wrap items-center gap-2">
            {a.previousAuditor.letterDocumentId ? (
              <span className="text-ink">
                Written communication filed: {a.previousAuditor.letterTitle}
              </span>
            ) : (
              <span className="text-ink-muted">
                The written communication to them must be uploaded before work starts.
              </span>
            )}
            {edit && (
              <>
                <input
                  ref={file}
                  type="file"
                  className="hidden"
                  aria-label="Letter to the previous auditor"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload.mutate(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => file.current?.click()}
                >
                  {a.previousAuditor.letterDocumentId ? 'Replace letter' : 'Upload letter'}
                </Button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Form and signing partner</h4>
        {edit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Form"
              hint={
                taxAuditRegime(a.financialYear).act === '2025'
                  ? `FY ${a.financialYear} is under the Income-tax Act 2025: one Form 26 (s.63, rule 47). Say whether the accounts are audited under another law.`
                  : '3CA: accounts audited under another law; 3CB: audited only for tax.'
              }
            >
              <Select
                value={a.formType ?? ''}
                disabled={busy}
                onChange={(e) =>
                  save.mutate({ formType: (e.target.value || null) as TaxAuditForm | null })
                }
              >
                <option value="">Choose…</option>
                {TAX_AUDIT_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {taxAuditFormLabel(a.financialYear, f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Signing partner"
              hint={`A valid COP and fewer than ${a.limit} tax audit reports for FY ${a.financialYear}.`}
            >
              <Select
                value={a.signingPartnerId ?? ''}
                disabled={busy}
                onChange={(e) => save.mutate({ signingPartnerId: e.target.value || null })}
              >
                <option value="">Choose…</option>
                {offered.map((p) => (
                  <option key={p.employeeId} value={p.employeeId}>
                    {p.summary}
                    {p.warning ? ' — near the limit' : ''}
                  </option>
                ))}
              </Select>
              {(() => {
                const chosen = offered.find((p) => p.employeeId === a.signingPartnerId);
                return chosen?.warning ? (
                  <p role="status" className="mt-1 text-xs font-medium text-warning-700">
                    Near the yearly limit: {chosen.warning}.
                  </p>
                ) : null;
              })()}
            </Field>
          </div>
        ) : (
          <p className="text-ink-muted">
            {a.formType ? taxAuditFormLabel(a.financialYear, a.formType) : 'No form yet'} ·{' '}
            {a.signingPartnerName ?? 'no signing partner yet'}
          </p>
        )}
        {edit && notOffered.length > 0 && (
          <ul className="space-y-0.5 text-xs text-ink-faint" aria-label="Partners not offered">
            {notOffered.map((p) => (
              <li key={p.employeeId}>
                {p.summary} — {p.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-medium text-ink">Appointment letter</h4>
        <div className="flex flex-wrap items-center gap-2">
          <span className={a.appointmentLetter ? 'text-ink' : 'text-ink-muted'}>
            {a.appointmentLetter
              ? `${a.appointmentLetter.title} (in the engagement’s documents)`
              : 'Not made yet. It names the form and the signing partner.'}
          </span>
          {edit && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !a.formType || !a.signingPartnerId}
              onClick={() => letter.mutate()}
            >
              {a.appointmentLetter ? 'Make it again' : 'Make from template'}
            </Button>
          )}
        </div>
      </section>

      {edit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button disabled={busy || a.missing.length > 0} onClick={() => accept.mutate()}>
            Accept the tax audit
          </Button>
          {a.missing.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-ink-muted" aria-label="Still to do">
              {a.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!edit && !a.acceptedAt && (
        <p className="text-xs text-ink-faint">
          The engagement’s partner or manager accepts the tax audit.
        </p>
      )}
    </div>
  );
}
