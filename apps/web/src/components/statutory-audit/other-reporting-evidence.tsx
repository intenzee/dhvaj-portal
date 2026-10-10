'use client';

import { useState } from 'react';
import { ExternalLink, Link2, Minus, Plus } from 'lucide-react';
import {
  REPORTING_EVIDENCE_KIND_LABEL,
  REPORTING_EVIDENCE_KINDS,
  type ReportingCardKey,
  type ReportingEvidenceKind,
  type StatutoryAuditReportingRecords,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button } from '@/components/ui';
import { Select } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker } from './acceptance-file-card';
import { useReportingRecords } from './reporting-records-query';

/**
 * 02.7 per-card evidence (spec §16 "View Evidence"): the engagement documents
 * linked to one requirement card — never a second upload. The count feeds the
 * card's "N linked items"; it expands in place (+/−). Given a Fraud Matter or a
 * director, it shows and links only that record's evidence (the §143(12) /
 * §143(3)(g) cards hold both the card-level and the per-record links).
 */
export function ReportingCardEvidence({
  engagementId,
  workflowInstanceId,
  cardKey,
  canManage,
  fraudMatterId,
  directorId,
  defaultOpen = false,
}: {
  engagementId: string;
  workflowInstanceId: string;
  cardKey: ReportingCardKey;
  canManage: boolean;
  fraudMatterId?: string;
  directorId?: string;
  defaultOpen?: boolean;
}): JSX.Element | null {
  const toast = useToast();
  const { q, busy, act } = useReportingRecords(engagementId, workflowInstanceId);
  const [open, setOpen] = useState(defaultOpen);
  const [linking, setLinking] = useState(false);
  const [kind, setKind] = useState<ReportingEvidenceKind>('evidence');
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  if (!q.data) return null;
  const view = q.data;
  const editable = canManage && view.canManage;
  const links = view.evidence.links.filter(
    (l) =>
      l.cardKey === cardKey &&
      (fraudMatterId === undefined || l.fraudMatterId === fraudMatterId) &&
      (directorId === undefined || l.directorId === directorId),
  );
  const openDoc = async (documentId: string) => {
    try {
      setDoc(await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the document.', 'error');
    }
  };
  const label = directorId ? 'director evidence' : fraudMatterId ? 'matter evidence' : 'evidence';

  return (
    <div className="text-xs" aria-label={`Evidence for ${cardKey}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        {links.length} linked item{links.length === 1 ? '' : 's'}
        <span className="text-ink-faint">· {label}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 pl-4">
          {links.length === 0 ? (
            <p className="text-ink-faint">
              Nothing linked yet. Link the evidence already on the file — no second upload.
            </p>
          ) : (
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  {l.documentId ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                      onClick={() => void openDoc(l.documentId!)}
                    >
                      {l.title} <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-ink">{l.title}</span>
                  )}
                  {l.kind !== 'evidence' && <Badge>{REPORTING_EVIDENCE_KIND_LABEL[l.kind]}</Badge>}
                  {l.inSharePoint && <Badge tone="info">SharePoint</Badge>}
                  {l.auditEvidenceId && <Badge>Section 06 evidence</Badge>}
                  <span className="text-ink-faint">
                    linked {formatDate(l.linkedAt)}
                    {l.linkedByName ? ` by ${l.linkedByName}` : ''}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      className="text-ink-faint hover:text-danger-700"
                      disabled={busy}
                      onClick={() =>
                        void act((base) =>
                          apiFetch<StatutoryAuditReportingRecords>(
                            `${base}/evidence/${l.id}/unlink`,
                            { method: 'POST', body: {} },
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              {directorId && (
                <Select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ReportingEvidenceKind)}
                  aria-label="Evidence purpose"
                  className="w-auto"
                >
                  {REPORTING_EVIDENCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {REPORTING_EVIDENCE_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-expanded={linking}
                onClick={() => setLinking((o) => !o)}
              >
                <Link2 className="h-3.5 w-3.5" /> Link Existing File
              </Button>
            </div>
          )}
          {editable && linking && (
            <LinkPicker
              engagementId={engagementId}
              exclude={links.map((l) => l.documentId).filter((d): d is string => !!d)}
              onPick={async (documentId) => {
                const ok = await act((base) =>
                  apiFetch<StatutoryAuditReportingRecords>(`${base}/evidence`, {
                    method: 'POST',
                    body: {
                      cardKey,
                      documentId,
                      fraudMatterId: fraudMatterId ?? null,
                      directorId: directorId ?? null,
                      kind: directorId ? kind : 'evidence',
                    },
                  }),
                );
                if (ok) setLinking(false);
              }}
            />
          )}
        </div>
      )}
      {doc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={doc}
          canEdit={false}
          onClose={() => setDoc(null)}
        />
      )}
    </div>
  );
}
