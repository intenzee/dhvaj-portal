'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import {
  CERTIFICATE_STATUS_LABEL,
  type Certificate,
  type CertificateFigures as Figures,
  type CertificateStatus,
  type CertificateTemplate,
} from '@hsdg/contracts';
import { ApiError, downloadFile } from '@/lib/api';
import {
  certificatePdfPath,
  certificateStep,
  certificatesKey,
  createCertificate,
  fetchCertificateTemplates,
  fetchCertificates,
  updateCertificate,
} from '@/lib/certificates-api';
import { formatDate } from '@/lib/format';
import { todayIst } from '@/components/work/my-task-columns';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';
import { CertificateFigures, figureErrors } from './certificate-figures';

export const CERTIFICATE_TONE: Record<CertificateStatus, string> = {
  draft: 'neutral',
  in_review: 'warn',
  signed: 'info',
  issued: 'success',
  revoked: 'danger',
};

/** The field errors the API sent back with a 400, if any. */
function apiFieldErrors(e: unknown): Record<string, string> {
  const errors = e instanceof ApiError ? e.body?.errors : undefined;
  return errors && typeof errors === 'object' ? (errors as Record<string, string>) : {};
}

/**
 * PS-402 — the certificates on an Assignment engagement: start one from a
 * template, fill its figures, send it for review, and the partner signs it
 * with the UDIN and issues the PDF (filed under Documents).
 */
export function CertificatesTab({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: [...certificatesKey, 'templates'],
    queryFn: fetchCertificateTemplates,
    staleTime: 5 * 60_000,
  });
  const list = useQuery({
    queryKey: [...certificatesKey, 'engagement', engagementId],
    queryFn: () => fetchCertificates(engagementId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: certificatesKey });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Certificates</h2>
        {!adding && templates.data && templates.data.length > 0 && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New certificate
          </Button>
        )}
      </div>
      {adding && templates.data && (
        <NewCertificate
          engagementId={engagementId}
          templates={templates.data}
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            setOpen(c.id);
            void refresh();
          }}
        />
      )}
      {list.isLoading && <Spinner />}
      {list.isError && <EmptyState>Could not load the certificates.</EmptyState>}
      {list.data && list.data.length === 0 && !adding && (
        <EmptyState>
          No certificates yet. Start one from a template — net worth, turnover, Form 146 and more.
        </EmptyState>
      )}
      {list.data && list.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2">Certificate</th>
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">UDIN</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => {
                const isOpen = open === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-raised"
                      onClick={() => setOpen(isOpen ? null : c.id)}
                    >
                      <td className="px-3 py-2">
                        <ExpandToggle open={isOpen} />
                      </td>
                      <td className="px-3 py-2">
                        {c.templateName}
                        {c.formLabel && (
                          <span className="ml-1 text-xs text-ink-faint">({c.formLabel})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.certificateNo ?? '—'}</td>
                      <td className="px-3 py-2">{c.purpose}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.udin ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge tone={CERTIFICATE_TONE[c.status]}>
                          {CERTIFICATE_STATUS_LABEL[c.status]}
                        </Badge>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line last:border-0">
                        <td colSpan={6} className="bg-surface-sunken/40 px-4 py-4">
                          <CertificateDetail
                            certificate={c}
                            template={templates.data?.find((t) => t.code === c.templateCode)}
                            onChanged={refresh}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VerifyNote({ template }: { template: CertificateTemplate }): JSX.Element | null {
  return (
    <p className="text-xs text-ink-muted">
      {[template.formLabel, template.legalRef].filter(Boolean).join(' · ')}
      {template.verification === 'verify' && (
        <Badge tone="warn" className="ml-2">
          Wording to be confirmed by a partner against the current law
        </Badge>
      )}
    </p>
  );
}

function NewCertificate({
  engagementId,
  templates,
  onClose,
  onSaved,
}: {
  engagementId: string;
  templates: CertificateTemplate[];
  onClose: () => void;
  onSaved: (c: Certificate) => void;
}): JSX.Element {
  const [code, setCode] = useState(templates[0]!.code);
  const [purpose, setPurpose] = useState('');
  const [addressee, setAddressee] = useState('');
  const [figures, setFigures] = useState<Figures>({});
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const template = templates.find((t) => t.code === code)!;
  const errors = { ...figureErrors(template, figures, tried), ...serverErrors };
  const save = useMutation({
    mutationFn: () =>
      createCertificate(engagementId, {
        templateCode: code,
        purpose: purpose.trim(),
        addressee: addressee.trim(),
        figures,
      }),
    onSuccess: onSaved,
    onError: (e: Error) => {
      setServerErrors(apiFieldErrors(e));
      setError(e.message);
    },
  });
  const ready =
    purpose.trim() !== '' &&
    addressee.trim() !== '' &&
    Object.keys(figureErrors(template, figures, true)).length === 0;

  return (
    <InlinePanel
      open
      onClose={onClose}
      title="New certificate"
      description="Pick the template, fill its figures and save it as a draft. It is reviewed, then a partner signs it with the UDIN."
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <span className="mr-auto text-xs text-danger-600">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setTried(true);
              setError(null);
              if (ready) save.mutate();
            }}
          >
            {save.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template" required className="sm:col-span-2">
            <Select
              aria-label="Template"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setFigures({});
                setServerErrors({});
                setTried(false);
              }}
            >
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <VerifyNote template={template} />
          </div>
          <Field label="Purpose" required hint="What the certificate is for — printed on it.">
            <Input
              aria-label="Purpose"
              value={purpose}
              maxLength={300}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Visa application"
            />
          </Field>
          <Field label="Addressed to" required>
            <Textarea
              aria-label="Addressed to"
              value={addressee}
              maxLength={500}
              className="min-h-10"
              onChange={(e) => setAddressee(e.target.value)}
              placeholder="The Consulate General of …"
            />
          </Field>
        </div>
        <CertificateFigures
          template={template}
          figures={figures}
          errors={errors}
          onChange={(f) => {
            setFigures(f);
            setServerErrors({});
          }}
        />
      </div>
    </InlinePanel>
  );
}

type Acting = null | 'edit' | 'return' | 'sign' | 'revoke' | 'form15ca';

function CertificateDetail({
  certificate: c,
  template,
  onChanged,
}: {
  certificate: Certificate;
  template: CertificateTemplate | undefined;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const today = todayIst();
  const [acting, setActing] = useState<Acting>(null);
  const [figures, setFigures] = useState<Figures>(c.figures);
  const [text, setText] = useState('');
  const [udin, setUdin] = useState('');
  const [signedOn, setSignedOn] = useState(today);
  const [generatedOn, setGeneratedOn] = useState(today);
  const [filedOn, setFiledOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const run = useMutation({
    mutationFn: (fn: () => Promise<Certificate>) => fn(),
    onSuccess: async () => {
      setActing(null);
      setText('');
      setError(null);
      await onChanged();
    },
    onError: (e: Error) => {
      setServerErrors(apiFieldErrors(e));
      setError(e.message);
    },
  });
  const start = (a: Acting) => {
    setActing(a);
    setError(null);
    setText('');
    setFigures(c.figures);
  };
  const editErrors = template ? { ...figureErrors(template, figures, true), ...serverErrors } : {};
  const busy = run.isPending;

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-muted">Addressed to</dt>
          <dd className="whitespace-pre-line">{c.addressee}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Prepared by</dt>
          <dd>{c.preparedBy?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Reviewed by</dt>
          <dd>{c.reviewedBy ? `${c.reviewedBy.name}, ${formatDate(c.reviewedAt)}` : 'Not yet'}</dd>
        </div>
        {c.signingPartner && (
          <div>
            <dt className="text-xs text-ink-muted">Signed by</dt>
            <dd>
              {c.signingPartner.name}
              {c.signingPartner.membershipNo && ` (M.No. ${c.signingPartner.membershipNo})`},{' '}
              {formatDate(c.signedOn)}
            </dd>
          </div>
        )}
        {c.issuedOn && (
          <div>
            <dt className="text-xs text-ink-muted">Issued</dt>
            <dd>{formatDate(c.issuedOn)} — the PDF is under Documents</dd>
          </div>
        )}
        {c.form15caAckNo && (
          <div>
            <dt className="text-xs text-ink-muted">Form 145 / 15CA</dt>
            <dd className="font-mono text-xs">
              {c.form15caAckNo}, {formatDate(c.form15caFiledOn)}
            </dd>
          </div>
        )}
        {c.reviewNote && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-ink-muted">Review note</dt>
            <dd>{c.reviewNote}</dd>
          </div>
        )}
        {c.revokedReason && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-danger-700">Revoked {formatDate(c.revokedAt)}</dt>
            <dd>{c.revokedReason}</dd>
          </div>
        )}
      </dl>

      {acting === 'edit' && template ? (
        <CertificateFigures
          template={template}
          figures={figures}
          errors={editErrors}
          onChange={(f) => {
            setFigures(f);
            setServerErrors({});
          }}
          disabled={busy}
        />
      ) : (
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {(template?.variables ?? []).map((v) =>
            c.figures[v.key] ? (
              <div key={v.key} className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-ink-muted">{v.label}</dt>
                <dd className="text-right">
                  {v.type === 'date' ? formatDate(c.figures[v.key]) : c.figures[v.key]}
                </dd>
              </div>
            ) : null,
          )}
        </dl>
      )}

      {acting === 'return' && (
        <Field label="What to change" required>
          <Textarea
            aria-label="What to change"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      )}
      {acting === 'revoke' && (
        <Field
          label="Why it is revoked"
          required
          hint={c.udin ? 'Its UDIN is revoked in the UDIN register with it.' : undefined}
        >
          <Textarea
            aria-label="Why it is revoked"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      )}
      {acting === 'sign' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="UDIN"
            required
            hint="As generated on the ICAI portal, on your membership no."
          >
            <Input
              aria-label="UDIN"
              value={udin}
              maxLength={18}
              className="font-mono"
              onChange={(e) => setUdin(e.target.value.toUpperCase())}
              placeholder="26123456ABCDEF1234"
            />
          </Field>
          <Field label="Signed on" required>
            <Input
              type="date"
              aria-label="Signed on"
              value={signedOn}
              max={today}
              onChange={(e) => setSignedOn(e.target.value)}
            />
          </Field>
          <Field label="UDIN generated on" required>
            <Input
              type="date"
              aria-label="UDIN generated on"
              value={generatedOn}
              max={today}
              onChange={(e) => setGeneratedOn(e.target.value)}
            />
          </Field>
        </div>
      )}
      {acting === 'form15ca' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Form 145 / 15CA acknowledgement no." required>
            <Input
              aria-label="Acknowledgement no."
              value={text}
              maxLength={40}
              className="font-mono"
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Field label="Filed on" required>
            <Input
              type="date"
              aria-label="Filed on"
              value={filedOn}
              max={today}
              onChange={(e) => setFiledOn(e.target.value)}
            />
          </Field>
        </div>
      )}

      {error && <p className="text-xs text-danger-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {acting ? (
          <>
            <Button
              size="sm"
              disabled={
                busy ||
                (acting === 'edit' && Object.keys(editErrors).length > 0) ||
                ((acting === 'return' || acting === 'revoke' || acting === 'form15ca') &&
                  !text.trim()) ||
                (acting === 'sign' && udin.trim().length !== 18)
              }
              onClick={() =>
                run.mutate(() => {
                  switch (acting) {
                    case 'edit':
                      return updateCertificate(c, { figures });
                    case 'return':
                      return certificateStep(c, {
                        to: 'review',
                        body: { decision: 'return', note: text.trim() },
                      });
                    case 'revoke':
                      return certificateStep(c, { to: 'revoke', body: { reason: text.trim() } });
                    case 'sign':
                      return certificateStep(c, {
                        to: 'sign',
                        body: { udin: udin.trim(), signedOn, udinGeneratedOn: generatedOn },
                      });
                    case 'form15ca':
                      return certificateStep(c, {
                        to: 'form-15ca',
                        body: { ackNo: text.trim(), filedOn },
                      });
                  }
                })
              }
            >
              {busy
                ? 'Saving…'
                : {
                    edit: 'Save figures',
                    return: 'Return to draft',
                    revoke: 'Revoke certificate',
                    sign: 'Sign',
                    form15ca: 'Record',
                  }[acting]}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setActing(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {c.can.edit && (
              <Button size="sm" variant="secondary" onClick={() => start('edit')}>
                Edit figures
              </Button>
            )}
            {c.can.submit && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run.mutate(() => certificateStep(c, { to: 'submit' }))}
              >
                Send for review
              </Button>
            )}
            {c.can.review && (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run.mutate(() =>
                      certificateStep(c, { to: 'review', body: { decision: 'approve' } }),
                    )
                  }
                >
                  Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => start('return')}>
                  Return with a note
                </Button>
              </>
            )}
            {c.can.sign && (
              <Button size="sm" onClick={() => start('sign')}>
                Sign with UDIN
              </Button>
            )}
            {c.can.issue && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run.mutate(() => certificateStep(c, { to: 'issue' }))}
              >
                Issue
              </Button>
            )}
            {c.can.recordForm15ca && !c.form15caAckNo && (
              <Button size="sm" variant="secondary" onClick={() => start('form15ca')}>
                Record Form 145 / 15CA
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void downloadFile(certificatePdfPath(c.engagementId, c.id), 'certificate.pdf')
              }
            >
              <Download className="h-4 w-4" />
              {c.status === 'issued' || c.status === 'signed' ? 'PDF' : 'Draft PDF'}
            </Button>
            {c.can.revoke && (
              <Button size="sm" variant="ghost" onClick={() => start('revoke')}>
                {c.status === 'draft' || c.status === 'in_review' ? 'Withdraw' : 'Revoke'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
