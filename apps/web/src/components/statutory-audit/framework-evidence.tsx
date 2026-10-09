'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, History, Link2, Lock, Trash2, Upload } from 'lucide-react';
import {
  FRAMEWORK_EVIDENCE_QUESTION_LABEL,
  FRAMEWORK_FILE_KIND_LABEL,
  PERMISSION,
  type FrameworkEvidenceQuestion,
  type FrameworkEvidenceView,
  type FrameworkFileRecord,
  type FrameworkMemoCreated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker, VersionHistory } from './acceptance-file-card';

/**
 * Evidence / Technical Memo for a Section 02 sub-assessment (DHVAJ 02.2 spec
 * §7, §18). Add File stores the file in the engagement's SharePoint workspace
 * and links it; Link Existing File links an engagement document without a
 * copy; Open opens it from the portal (Microsoft 365 when on); Version
 * History shows SharePoint's history. "Create Technical Memo" appears only
 * when the conclusion needs one (override, consultation, pending information,
 * partner approval) — a Manager may still create one on demand. Everything
 * expands in place; nothing opens a modal except the document itself.
 *
 * With `question` (FRF-02 / FRF-03, §6–§7) it is that question's evidence:
 * only its files, filed under it, and no memo. Without it, every file shows,
 * question-filed ones badged with their question.
 */
export function FrameworkEvidence({
  engagementId,
  workflowInstanceId,
  subAssessmentId,
  memoSuggested,
  readOnly,
  question,
}: {
  engagementId: string;
  workflowInstanceId: string;
  subAssessmentId: string;
  memoSuggested: boolean;
  readOnly: boolean;
  question?: FrameworkEvidenceQuestion;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/framework/${subAssessmentId}/evidence`;
  const key = ['engagement', engagementId, 'framework-evidence', subAssessmentId];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<FrameworkEvidenceView>(base) });
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [onDemand, setOnDemand] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (q.isLoading) return <Spinner label="Loading evidence…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the evidence.'}
      </p>
    );
  }
  const view = q.data;
  const editable = !readOnly && !view.readOnly && can(principal, PERMISSION.engagementManage);
  const fail = (e: unknown) =>
    toast(e instanceof ApiError ? e.message : 'Could not update the evidence.', 'error');
  const act = async (fn: () => Promise<FrameworkEvidenceView>): Promise<void> => {
    setBusy(true);
    try {
      qc.setQueryData(key, await fn());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const openFile = async (documentId: string): Promise<void> => {
    try {
      setOpenDoc(
        await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`),
      );
    } catch (e) {
      fail(e);
    }
  };
  const memo = question ? null : view.memo;
  const files = question ? view.files.filter((f) => f.questionKey === question) : view.files;
  const filedUnder = question ? { questionKey: question } : {};
  const what = question ? `${FRAMEWORK_EVIDENCE_QUESTION_LABEL[question]} evidence` : 'evidence';
  const showMemo =
    memo !== null && memo.memoFileId === null && editable && (memoSuggested || onDemand);

  const createMemo = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiFetch<FrameworkMemoCreated>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/financial-reporting/memo`,
        { method: 'POST', body: {} },
      );
      qc.setQueryData(key, res.evidence);
      toast(
        res.missingFields.length
          ? `Memo created — fill in: ${res.missingFields.join(', ')}.`
          : 'Technical memo created.',
      );
      if (res.editorUrl) window.open(res.editorUrl, '_blank', 'noopener,noreferrer');
      else await openFile(res.documentId);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-2"
      aria-label={
        question
          ? `${FRAMEWORK_EVIDENCE_QUESTION_LABEL[question]} evidence`
          : 'Evidence and technical memo'
      }
    >
      {files.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {question
            ? `No ${what} linked yet.`
            : 'No evidence linked yet. The structured assessment is the workpaper; add evidence where a fact needs support.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <FileItem
              key={f.id}
              base={base}
              file={f}
              showQuestion={!question}
              editable={editable}
              busy={busy}
              onOpen={() => void openFile(f.documentId)}
              onRemove={() =>
                void act(() =>
                  apiFetch<FrameworkEvidenceView>(`${base}/${f.id}/unlink`, {
                    method: 'POST',
                    body: {},
                  }),
                )
              }
            />
          ))}
        </ul>
      )}

      {memo && memo.memoFileId === null && (memoSuggested || onDemand) && (
        <div className="rounded-md border border-primary-100 bg-primary-50/50 px-3 py-2 text-xs">
          <p className="font-medium text-ink">Financial Reporting Framework technical memo</p>
          <p className="text-ink-muted">
            {memoSuggested
              ? 'This conclusion needs a technical memo (override, consultation, pending information or partner approval).'
              : 'Created on demand — routine cases do not need a separate memo.'}
          </p>
          {memo.reason && <p className="mt-1 text-warning-700">{memo.reason}</p>}
          {showMemo && (
            <Button
              size="sm"
              className="mt-1.5"
              disabled={busy || !memo.templateAvailable}
              onClick={() => void createMemo()}
            >
              <FilePlus2 className="h-3.5 w-3.5" /> {busy ? 'Creating…' : 'Create Technical Memo'}
            </Button>
          )}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Add File'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={linking}
            onClick={() => setLinking((o) => !o)}
          >
            <Link2 className="h-3.5 w-3.5" /> Link Existing File
          </Button>
          {memo && memo.memoFileId === null && !memoSuggested && !onDemand && (
            <Button size="sm" variant="ghost" onClick={() => setOnDemand(true)}>
              <FilePlus2 className="h-3.5 w-3.5" /> Technical memo…
            </Button>
          )}
          <input
            ref={input}
            type="file"
            className="hidden"
            aria-label={question ? `Add a file to ${what}` : 'Add an evidence file'}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void act(async () =>
                apiFetch<FrameworkEvidenceView>(`${base}/add`, {
                  method: 'POST',
                  body: {
                    filename: file.name,
                    contentType: file.type || undefined,
                    contentBase64: await blobToBase64(file),
                    ...filedUnder,
                  },
                }),
              );
            }}
          />
        </div>
      )}
      {editable && linking && (
        <LinkPicker
          engagementId={engagementId}
          exclude={files.map((f) => f.documentId)}
          onPick={async (documentId) => {
            await act(() =>
              apiFetch<FrameworkEvidenceView>(`${base}/link`, {
                method: 'POST',
                body: { documentId, ...filedUnder },
              }),
            );
            setLinking(false);
          }}
        />
      )}
      {openDoc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={openDoc}
          canEdit={editable}
          onClose={() => setOpenDoc(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: key })}
        />
      )}
    </div>
  );
}

function FileItem({
  base,
  file: f,
  showQuestion,
  editable,
  busy,
  onOpen,
  onRemove,
}: {
  base: string;
  file: FrameworkFileRecord;
  showQuestion: boolean;
  editable: boolean;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
}): JSX.Element {
  const [history, setHistory] = useState(false);
  return (
    <li className="rounded-md border border-line bg-surface p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-ink">{f.filename ?? f.title}</span>
            {f.kind === 'technical_memo' && (
              <Badge tone="info">{FRAMEWORK_FILE_KIND_LABEL[f.kind]}</Badge>
            )}
            {showQuestion && f.questionKey && (
              <Badge tone="neutral">{FRAMEWORK_EVIDENCE_QUESTION_LABEL[f.questionKey]}</Badge>
            )}
            {f.editLocked && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                <Lock className="h-3 w-3" /> Read-only
              </span>
            )}
          </span>
          <span className="block text-[11px] text-ink-faint">
            v{f.currentVersionNo} · {f.linkedByName ?? '—'} · {formatDate(f.linkedAt)}
            {f.lastEditedBy ? ` · last edited by ${f.lastEditedBy}` : ''}
            {f.templateVersionNo ? ` · template v${f.templateVersionNo}` : ''}
            {f.inSharePoint ? ' · in SharePoint' : ''}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onOpen}>
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={history}
            onClick={() => setHistory((o) => !o)}
          >
            <History className="h-3.5 w-3.5" /> Version History
          </Button>
          {editable && !f.editLocked && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`Remove ${f.filename ?? f.title}`}
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      </div>
      {history && <VersionHistory base={base} fileId={f.id} />}
    </li>
  );
}
