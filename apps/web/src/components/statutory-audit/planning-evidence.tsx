'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, History, Link2, Paperclip, Trash2, Upload } from 'lucide-react';
import type {
  PlanningEvidenceFile,
  PlanningEvidenceTarget,
  PlanningEvidenceView,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Button, Spinner } from '@/components/ui';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker, VersionHistory } from './acceptance-file-card';
import { usePlanningGov } from './planning-governance';

/**
 * §24 evidence on a 03.1 record (signal, significant change, prior-year matter,
 * acceptance matter, team discussion). Files live in the engagement workspace
 * (SharePoint when Microsoft 365 is on): Add File stores a new engagement
 * document, Link Existing File points at one — never a copy. Opens inline
 * under the record with +/−; the count comes from the governance read so a
 * closed record costs no request.
 */
export function PlanningEvidence({
  targetType,
  targetId,
}: {
  targetType: PlanningEvidenceTarget;
  targetId: string;
}): JSX.Element {
  const gov = usePlanningGov();
  const [open, setOpen] = useState(false);
  const count = gov.view?.evidenceCounts[targetId] ?? 0;
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Paperclip className="h-4 w-4" />
        {open ? '−' : '+'} Evidence{count ? ` (${count})` : ''}
      </Button>
      {open && <EvidenceBody targetType={targetType} targetId={targetId} />}
    </div>
  );
}

function EvidenceBody({
  targetType,
  targetId,
}: {
  targetType: PlanningEvidenceTarget;
  targetId: string;
}): JSX.Element {
  const gov = usePlanningGov();
  const toast = useToast();
  const qc = useQueryClient();
  const [linking, setLinking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const qk = ['planning-evidence', gov.base, targetType, targetId];
  const q = useQuery({
    queryKey: qk,
    queryFn: () =>
      apiFetch<PlanningEvidenceView>(
        `${gov.base}/planning-evidence?targetType=${targetType}&targetId=${targetId}`,
      ),
  });
  const onSaved = (v: PlanningEvidenceView) => {
    qc.setQueryData(qk, v);
    gov.refresh();
  };
  const onError = (e: unknown) =>
    toast(e instanceof ApiError ? e.message : 'Could not save the evidence.', 'error');

  const add = useMutation({
    mutationFn: async (file: File) =>
      apiFetch<PlanningEvidenceView>(`${gov.base}/planning-evidence/add`, {
        method: 'POST',
        body: {
          targetType,
          targetId,
          filename: file.name,
          contentType: file.type || undefined,
          contentBase64: await blobToBase64(file),
        },
      }),
    onSuccess: onSaved,
    onError,
  });

  if (q.isLoading) return <Spinner label="Loading evidence…" />;
  const v = q.data;
  if (!v) return <p className="text-xs text-danger-700">Could not load the evidence.</p>;
  const mayAdd = v.canAdd && gov.can('addFacts');

  return (
    <div className="mt-1 space-y-2 rounded-md border border-line bg-surface-sunken/40 p-2">
      {v.files.length === 0 ? (
        <p className="text-xs text-ink-muted">No evidence attached.</p>
      ) : (
        <ul className="space-y-1.5">
          {v.files.map((f) => (
            <EvidenceRow key={f.id} file={f} onSaved={onSaved} onError={onError} />
          ))}
        </ul>
      )}
      {mayAdd && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            {v.canUpload && (
              <Button
                size="sm"
                variant="secondary"
                disabled={add.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {add.isPending ? 'Uploading…' : 'Add File'}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setLinking((o) => !o)}
              aria-expanded={linking}
            >
              <Link2 className="h-4 w-4" /> Link Existing File
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              aria-label="Add an evidence file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) add.mutate(file);
              }}
            />
          </div>
          {!v.canUpload && (
            <p className="text-[11px] text-ink-faint">
              Upload new files to the engagement’s documents first, then link them here.
            </p>
          )}
          {linking && (
            <LinkPicker
              engagementId={gov.engagementId}
              exclude={v.files.map((f) => f.documentId)}
              onPick={async (documentId) => {
                try {
                  onSaved(
                    await apiFetch<PlanningEvidenceView>(`${gov.base}/planning-evidence/link`, {
                      method: 'POST',
                      body: { targetType, targetId, documentId },
                    }),
                  );
                  setLinking(false);
                } catch (e) {
                  onError(e);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceRow({
  file: f,
  onSaved,
  onError,
}: {
  file: PlanningEvidenceFile;
  onSaved: (v: PlanningEvidenceView) => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const gov = usePlanningGov();
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const unlink = useMutation({
    mutationFn: () =>
      apiFetch<PlanningEvidenceView>(`${gov.base}/planning-evidence/${f.id}/unlink`, {
        method: 'POST',
      }),
    onSuccess: onSaved,
    onError,
  });
  const open = async (): Promise<void> => {
    try {
      setOpenDoc(
        await apiFetch<DocumentRow>(`/engagements/${gov.engagementId}/documents/${f.documentId}`),
      );
    } catch (e) {
      onError(e);
    }
  };
  return (
    <li className="rounded-md border border-line bg-surface px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate text-xs text-ink">{f.filename ?? f.title}</span>
          <p className="text-[11px] text-ink-faint">
            v{f.currentVersionNo}
            {f.lastEditedBy ? ` · last edited by ${f.lastEditedBy}` : ''}
            {f.linkedByName ? ` · linked by ${f.linkedByName}` : ''}
            {f.inSharePoint ? ' · in SharePoint' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void open()}>
            <ExternalLink className="h-4 w-4" /> Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHistory((o) => !o)}
            aria-expanded={showHistory}
          >
            <History className="h-4 w-4" /> Version History
          </Button>
          {f.removable && gov.can('addFacts') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={unlink.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Remove this file from the record? The document stays on the engagement.',
                  )
                )
                  unlink.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          )}
        </div>
      </div>
      {showHistory && <VersionHistory base={`${gov.base}/planning-evidence`} fileId={f.id} />}
      {openDoc && (
        <DocumentPreview
          engagementId={gov.engagementId}
          doc={openDoc}
          canEdit={!f.editLocked && gov.can('addFacts')}
          onClose={() => setOpenDoc(null)}
          onSaved={() => gov.refresh()}
        />
      )}
    </li>
  );
}
