'use client';

import { ACCEPTANCE_FILE_SLOT, ACCEPTANCE_FILE_STATUS_LABEL, type AcceptanceFilesView } from '@hsdg/contracts';
import { Badge, Card } from '@/components/ui';
import { AcceptanceFileCard } from './acceptance-file-card';
import { useAcceptanceFiles } from './acceptance-files';

/** Where each §10.2 format lives in Section 01. */
const FORMAT_HOME: Record<string, { slot: string; segment: string }> = {
  previous_auditor_communication: { slot: ACCEPTANCE_FILE_SLOT.previousAuditorCommunication, segment: '01.3' },
  auditor_consent_certificate: { slot: ACCEPTANCE_FILE_SLOT.consentCertificate, segment: '01.2' },
  engagement_letter: { slot: ACCEPTANCE_FILE_SLOT.engagementLetter, segment: '01.7' },
  client_acknowledgement: { slot: ACCEPTANCE_FILE_SLOT.clientAcknowledgement, segment: '01.7' },
};

/**
 * 01.7 Engagement Letter & Documents (spec §10). The letter moves Draft →
 * Partner Review → Approved → Issued → Accepted; only the Engagement Partner
 * approves it, and Section 01 cannot be accepted until it is approved. The
 * delivery evidence, client acknowledgement and appointment filing sit beside
 * it, and §10.2 lists the firm formats Section 01 creates from templates.
 */
export function EngagementLetterSection({
  engagementId,
  workflowInstanceId,
  editable,
}: {
  engagementId: string;
  workflowInstanceId: string;
  editable: boolean;
}): JSX.Element {
  const files = useAcceptanceFiles(engagementId, workflowInstanceId);
  const card = (slotKey: string, hint?: string) => (
    <AcceptanceFileCard
      engagementId={engagementId}
      workflowInstanceId={workflowInstanceId}
      slotKey={slotKey}
      editable={editable}
      hint={hint}
    />
  );
  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Engagement letter (SA 210)</h3>
          <p className="text-xs text-ink-muted">
            Draft → Partner Review → Approved → Issued → Accepted. The Engagement Partner approves the letter; the
            issue date and mode of delivery are recorded when it goes out.
          </p>
        </div>
        {card(ACCEPTANCE_FILE_SLOT.engagementLetter)}
        {card(ACCEPTANCE_FILE_SLOT.engagementLetterDelivery, 'Email, portal upload receipt or courier acknowledgement.')}
        {card(ACCEPTANCE_FILE_SLOT.clientAcknowledgement, 'Where the client signs back an acknowledgement / acceptance.')}
        {card(
          ACCEPTANCE_FILE_SLOT.appointmentFiling,
          'Appointment resolution, ADT-1 or other statutory filing evidence.',
        )}
      </Card>
      {files.data && <FormatsCard view={files.data} />}
    </div>
  );
}

/** §10.2 — the firm formats, whether each has an approved template, and its file. */
function FormatsCard({ view }: { view: AcceptanceFilesView }): JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="mb-1 text-sm font-semibold text-ink">Section 01 formats</h3>
      <p className="mb-2 text-xs text-ink-muted">
        Created from the firm&apos;s approved DHVAJ templates, prefilled from the masters and Section 01 answers.
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-faint">
          <tr>
            <th className="py-1 font-medium">Format</th>
            <th className="py-1 font-medium">Used in</th>
            <th className="py-1 font-medium">Template</th>
            <th className="py-1 font-medium">This engagement</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {view.templates.map((t) => {
            const home = FORMAT_HOME[t.templateKey];
            const file = home ? view.files.find((f) => f.slotKey === home.slot) : undefined;
            return (
              <tr key={t.templateKey}>
                <td className="py-1.5 text-ink">{t.title}</td>
                <td className="py-1.5 text-ink-muted">{home?.segment ?? '—'}</td>
                <td className="py-1.5">
                  {t.available ? (
                    <span className="text-xs text-ink-muted">
                      {t.variantKey && t.variantKey !== 'standard' ? `${t.variantKey} ` : ''}v{t.versionNo}
                    </span>
                  ) : (
                    <Badge tone="warn" className="whitespace-nowrap">
                      Not uploaded
                    </Badge>
                  )}
                </td>
                <td className="py-1.5 text-xs text-ink-muted">
                  {file ? ACCEPTANCE_FILE_STATUS_LABEL[file.status] : 'Not Created'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
