'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TAX_AUDIT_STAGE_LABEL, type TaxAuditFiling } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { istToday } from '@/lib/people';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Textarea } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';

type Act = { path: string; body: Record<string, unknown>; message: string };

const fileBody = async (f: File | null): Promise<Record<string, string>> =>
  f
    ? {
        filename: f.name,
        ...(f.type ? { contentType: f.type } : {}),
        contentBase64: await blobToBase64(f),
      }
    : {};

/** One line of the report's progress: what happened, and when. */
function Step({
  label,
  done,
  children,
}: {
  label: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-40 text-ink">{label}</span>
      {done ? (
        <Badge tone="success">{children}</Badge>
      ) : (
        <span className="text-ink-faint">Not yet</span>
      )}
    </li>
  );
}

/**
 * Tax Audit report and filing (Phase 5, F-8), opened under the year's row:
 * the signing Partner signs (UDIN and the signed report) once the review is
 * signed off; the engagement's partner or manager, or the signing Partner,
 * records the upload, the client's acceptance or rejection (back to review)
 * and the filing with its acknowledgement — which lodges the year's filing.
 * A filed report can be revised.
 */
export function FilingDesk({
  engagementId,
  auditId,
}: {
  engagementId: string;
  auditId: string;
}): JSX.Element {
  const base = `/engagements/${engagementId}/tax-audits/${auditId}/filing`;
  const key = [...TAX_AUDITS_KEY, 'filing', auditId];
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<TaxAuditFiling>(base) });
  const act = useMutation({
    mutationFn: ({ path, body }: Act) =>
      apiFetch<TaxAuditFiling>(`${base}${path}`, { method: 'POST', body }),
    onSuccess: (next, { message }) => {
      if (next.auditId === auditId) qc.setQueryData(key, next);
      void qc.invalidateQueries({ queryKey: TAX_AUDITS_KEY });
      toast(message);
    },
    onError: (err: unknown) =>
      toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });

  const today = istToday();
  const [udin, setUdin] = useState('');
  const [report, setReport] = useState<File | null>(null);
  const [onDate, setOnDate] = useState(today);
  const [reason, setReason] = useState('');
  const [ackNo, setAckNo] = useState('');
  const [ack, setAck] = useState<File | null>(null);

  if (q.isLoading) return <Spinner label="Loading the report…" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger-700">Could not load it.</p>;
  const f = q.data;
  const busy = act.isPending;
  const run = (a: Act): void => {
    act.mutate(a, {
      onSuccess: () => {
        setReason('');
        setOnDate(today);
      },
    });
  };
  const reasonBox = (label: string) => (
    <Field label={label}>
      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Field>
  );
  const dateBox = (label: string) => (
    <Field label={label}>
      <Input type="date" value={onDate} max={today} onChange={(e) => setOnDate(e.target.value)} />
    </Field>
  );
  const rejectedBefore =
    f.clientRejectedOn && !['client_accepted', 'filed'].includes(f.stage) ? (
      <p className="text-xs text-warn-700">
        The client rejected the report on {formatDate(f.clientRejectedOn)}:{' '}
        {f.clientRejectionReason}
      </p>
    ) : null;

  return (
    <div className="space-y-5 text-sm">
      {f.revision > 0 && (
        <p className="text-ink-muted">
          Revised report (revision {f.revision}): {f.revisionReason}
        </p>
      )}

      <section className="space-y-2">
        <h4 className="font-medium text-ink">
          Form {f.formType ?? '3CA / 3CB'} and 3CD, FY {f.financialYear}
        </h4>
        <ol className="space-y-1">
          <Step label="Signed" done={!!f.signedAt}>
            {f.signedByName ?? '—'} · {f.signedAt ? formatDate(f.signedAt) : ''} · UDIN {f.udin}
          </Step>
          <Step label="Uploaded" done={!!f.uploadedOn}>
            {f.uploadedOn ? formatDate(f.uploadedOn) : ''}
          </Step>
          <Step label="Accepted by client" done={!!f.clientAcceptedOn}>
            {f.clientAcceptedOn ? formatDate(f.clientAcceptedOn) : ''}
          </Step>
          <Step label="Filed" done={f.stage === 'filed'}>
            {f.filedOn ? formatDate(f.filedOn) : ''}
            {f.acknowledgementNo ? ` · Ack ${f.acknowledgementNo}` : ''}
          </Step>
        </ol>
        {f.signedReport && <p className="text-xs text-ink-muted">{f.signedReport.title}</p>}
        {f.acknowledgement && <p className="text-xs text-ink-muted">{f.acknowledgement.title}</p>}
        {rejectedBefore}
      </section>

      {f.stage === 'review' && (
        <section className="space-y-2">
          <h4 className="font-medium text-ink">Sign the report</h4>
          {f.signingBlockers.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-ink-muted">
              {f.signingBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            !f.can.sign && (
              <p className="text-ink-muted">
                Ready for {f.signingPartnerName ?? 'the signing Partner'} to sign.
              </p>
            )
          )}
          {f.can.sign && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="UDIN">
                <Input
                  value={udin}
                  maxLength={30}
                  className="font-mono"
                  onChange={(e) => setUdin(e.target.value)}
                />
              </Field>
              <Field label="Signed report">
                <input
                  type="file"
                  accept="application/pdf"
                  aria-label="Signed report"
                  onChange={(e) => setReport(e.target.files?.[0] ?? null)}
                />
              </Field>
              <Button
                size="sm"
                disabled={busy || !udin.trim() || !report}
                onClick={async () =>
                  run({
                    path: '/sign',
                    body: { udin, version: f.version, ...(await fileBody(report)) },
                    message: 'The report is signed.',
                  })
                }
              >
                Sign
              </Button>
            </div>
          )}
        </section>
      )}

      {f.stage === 'signed' && (f.can.upload || f.can.withdraw) && (
        <section className="space-y-3">
          {f.can.upload && (
            <div className="flex flex-wrap items-end gap-3">
              {dateBox('Uploaded on the e-filing portal')}
              <Button
                size="sm"
                disabled={busy || !onDate}
                onClick={() =>
                  run({
                    path: '/uploaded',
                    body: { uploadedOn: onDate, version: f.version },
                    message: 'Upload recorded.',
                  })
                }
              >
                Record the upload
              </Button>
            </div>
          )}
          {f.can.withdraw && (
            <div className="space-y-2">
              {reasonBox('Why withdraw the signature (revoke the UDIN on the ICAI portal too)')}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  run({
                    path: '/withdraw',
                    body: { reason, version: f.version },
                    message: 'Signature withdrawn; the report is back in review.',
                  })
                }
              >
                Withdraw the signature
              </Button>
            </div>
          )}
        </section>
      )}

      {f.stage === 'uploaded' && f.can.clientDecision && (
        <section className="space-y-2">
          <h4 className="font-medium text-ink">The client’s answer on the portal</h4>
          {dateBox('On')}
          <Button
            size="sm"
            disabled={busy || !onDate}
            onClick={() =>
              run({
                path: '/client-accepted',
                body: { acceptedOn: onDate, version: f.version },
                message: 'Client’s acceptance recorded.',
              })
            }
          >
            Accepted
          </Button>
          {reasonBox('Why the client rejected it')}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !onDate || !reason.trim()}
            onClick={() =>
              run({
                path: '/client-rejected',
                body: { rejectedOn: onDate, reason, version: f.version },
                message: 'Rejection recorded; the report is back in review.',
              })
            }
          >
            Rejected
          </Button>
        </section>
      )}

      {f.stage === 'client_accepted' && f.can.file && (
        <section className="space-y-2">
          <h4 className="font-medium text-ink">Filed</h4>
          {f.complianceInstanceId && (
            <p className="text-xs text-ink-muted">
              This lodges the year’s tax audit report filing; the audit-case ITR can then follow.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Acknowledgement number">
              <Input value={ackNo} maxLength={60} onChange={(e) => setAckNo(e.target.value)} />
            </Field>
            {dateBox('Filed on')}
            <Field label="Acknowledgement">
              <input
                type="file"
                aria-label="Acknowledgement"
                onChange={(e) => setAck(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Button
              size="sm"
              disabled={busy || !ackNo.trim() || !onDate}
              onClick={async () =>
                run({
                  path: '/filed',
                  body: {
                    acknowledgementNo: ackNo,
                    filedOn: onDate,
                    version: f.version,
                    ...(await fileBody(ack)),
                  },
                  message: 'The report is filed.',
                })
              }
            >
              Record the filing
            </Button>
          </div>
        </section>
      )}

      {f.stage === 'filed' && f.can.revise && (
        <section className="space-y-2">
          <h4 className="font-medium text-ink">Revise the report</h4>
          <p className="text-xs text-ink-muted">
            The revision starts from this report’s clauses and goes through review, signing and
            filing again.
          </p>
          {reasonBox('Why the report is revised')}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !reason.trim()}
            onClick={() =>
              run({
                path: '/revise',
                body: { reason, version: f.version },
                message: 'Revision started; open it from its row.',
              })
            }
          >
            Start a revised report
          </Button>
        </section>
      )}

      {f.revisions.length > 1 && (
        <section className="space-y-1">
          <h4 className="font-medium text-ink">Reports for the year</h4>
          <ul className="space-y-1">
            {f.revisions.map((r) => (
              <li key={r.id} className={r.id === f.auditId ? 'text-ink' : 'text-ink-muted'}>
                {r.revision === 0 ? 'Original' : `Revision ${r.revision}`} ·{' '}
                {TAX_AUDIT_STAGE_LABEL[r.stage]}
                {r.filedOn ? ` · filed ${formatDate(r.filedOn)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
