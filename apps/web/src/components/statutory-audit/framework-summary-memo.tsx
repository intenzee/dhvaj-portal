'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, FileText, History, Lock, Send } from 'lucide-react';
import {
  FRAMEWORK_MEMO_STATUS_LABEL,
  type FrameworkMemoCard,
  type FrameworkMemoHistoryItem,
  type FrameworkMemorandumCreated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { fetchM365Session, isM365Enabled } from '@/lib/m365';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Card } from '@/components/ui';
import { DocumentPreview } from '@/components/document-preview';
import { VersionHistory } from './acceptance-file-card';
import { PanelHeading } from './framework-summary-shared';
import { FRAMEWORK_SUMMARY_QK, type FrameworkSummaryPanelProps } from './framework-summary-types';

const STATUS_TONE: Record<FrameworkMemoCard['status'], string> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  superseded: 'neutral',
};

/**
 * 02.8 §10–§11 Audit Framework Memorandum — generated from the approved DHVAJ
 * Word template once the Manager has confirmed the framework (AF-01), filed in
 * the engagement's SharePoint workspace and edited in Microsoft 365. Submit for
 * Review hands it to the Engagement Partner (AF-02), whose approval makes it the
 * controlled, read-only version. A reopened revision gets a NEW memorandum; the
 * approved ones stay in the history.
 */
export function FrameworkSummaryMemo({
  engagementId,
  summary,
  canManage,
  onChanged,
}: FrameworkSummaryPanelProps): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const base = `/engagements/${engagementId}/statutory-audit/${summary.workflowInstanceId}/framework-summary`;
  const memosKey = [...FRAMEWORK_SUMMARY_QK(engagementId), 'memos', summary.workflowInstanceId];
  const memos = useQuery({
    queryKey: memosKey,
    queryFn: () => apiFetch<FrameworkMemoHistoryItem[]>(`${base}/memos`),
  });
  const memo = summary.memo;
  const memoId = memo
    ? (memos.data?.find((x) => x.documentId === memo.documentId)?.memoId ?? null)
    : null;
  const earlier = (memos.data ?? []).filter((x) => x.documentId !== memo?.documentId);

  const fail = (e: unknown, what: string): void =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`, 'error');
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: memosKey });
    onChanged();
  };
  const openFile = async (documentId: string): Promise<void> => {
    try {
      setOpenDoc(
        await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`),
      );
    } catch (e) {
      fail(e, 'open the memorandum');
    }
  };
  const edit = async (documentId: string): Promise<void> => {
    if (!isM365Enabled) return openFile(documentId);
    try {
      const s = await fetchM365Session(engagementId, documentId);
      window.open(s.editorUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      fail(e, 'open Microsoft 365');
    }
  };
  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiFetch<FrameworkMemorandumCreated>(`${base}/memo`, {
        method: 'POST',
        body: {},
      });
      toast(
        res.missingFields.length
          ? `Memorandum created — complete: ${res.missingFields.join(', ')}.`
          : 'Audit Framework Memorandum created.',
      );
      refresh();
      if (res.editorUrl) window.open(res.editorUrl, '_blank', 'noopener,noreferrer');
      else await openFile(res.memo.documentId);
    } catch (e) {
      fail(e, 'create the memorandum');
    } finally {
      setBusy(false);
    }
  };
  const submit = async (): Promise<void> => {
    if (!memoId) return;
    setBusy(true);
    try {
      await apiFetch<FrameworkMemoCard>(`${base}/memo/${memoId}/submit`, {
        method: 'POST',
        body: {},
      });
      toast('Memorandum submitted for Engagement Partner review.');
      refresh();
    } catch (e) {
      fail(e, 'submit the memorandum');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4" aria-label="Audit Framework Memorandum">
      <PanelHeading
        title="Audit Framework Memorandum"
        hint="Generated from the approved DHVAJ template after the Manager confirmation (AF-01)."
      />
      {!memo ? (
        <div className="text-sm">
          <p className="text-ink-muted">
            {summary.gates.canCreateMemo
              ? 'The framework is Manager-confirmed — create the memorandum, complete it in Word and submit it for Partner approval.'
              : summary.baseline?.status === 'approved'
                ? 'The framework was approved without a memorandum on this version.'
                : 'Available once the Manager confirms the framework (AF-01).'}
          </p>
          {canManage && summary.gates.canCreateMemo && (
            <Button size="sm" className="mt-2" disabled={busy} onClick={() => void create()}>
              <FilePlus2 className="h-3.5 w-3.5" /> {busy ? 'Creating…' : 'Create Memorandum'}
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-line bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5">
                <FileText className="h-4 w-4 text-ink-faint" />
                <span className="truncate font-medium text-ink">{memo.fileName}</span>
                <Badge tone={STATUS_TONE[memo.status]}>
                  {FRAMEWORK_MEMO_STATUS_LABEL[memo.status]}
                </Badge>
                {memo.status === 'approved' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                    <Lock className="h-3 w-3" /> Controlled
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {memo.workItem} · Framework v{memo.baselineVersion} · File {memo.version ?? '—'}
              </p>
              <p className="text-xs text-ink-faint">
                Prepared by {memo.preparedByName ?? '—'} · Last edited by{' '}
                {memo.lastEditorName ?? '—'}
                {memo.lastSavedAt ? ` · ${formatDate(memo.lastSavedAt)}` : ''}
                {memo.submittedAt ? ` · Submitted ${formatDate(memo.submittedAt)}` : ''}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void openFile(memo.documentId)}>
              <FileText className="h-3.5 w-3.5" /> Open
            </Button>
            {canManage && memo.status === 'draft' && (
              <Button size="sm" variant="secondary" onClick={() => void edit(memo.documentId)}>
                <ExternalLink className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            {memoId && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={history}
                onClick={() => setHistory((h) => !h)}
              >
                <History className="h-3.5 w-3.5" /> Version History
              </Button>
            )}
            {canManage &&
              memo.status === 'draft' &&
              summary.baseline?.status === 'manager_confirmed' && (
                <Button size="sm" disabled={busy || !memoId} onClick={() => void submit()}>
                  <Send className="h-3.5 w-3.5" /> {busy ? 'Submitting…' : 'Submit for Review'}
                </Button>
              )}
          </div>
          {history && memoId && <VersionHistory base={`${base}/memo`} fileId={memoId} />}
        </div>
      )}

      {earlier.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Earlier memoranda
          </p>
          <ul className="space-y-1 text-xs">
            {earlier.map((x) => (
              <li key={x.memoId} className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="text-primary-700 hover:underline"
                  onClick={() => void openFile(x.documentId)}
                >
                  {x.fileName}
                </button>
                <Badge tone={STATUS_TONE[x.status]}>{FRAMEWORK_MEMO_STATUS_LABEL[x.status]}</Badge>
                <span className="text-ink-faint">
                  v{x.baselineVersion}
                  {x.controlledVersionNo ? ` · controlled file v${x.controlledVersionNo}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openDoc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={openDoc}
          canEdit={canManage && memo?.documentId === openDoc.id && memo.status === 'draft'}
          onClose={() => setOpenDoc(null)}
          onSaved={refresh}
        />
      )}
    </Card>
  );
}
