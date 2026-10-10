'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, History, Link2, Minus, Plus } from 'lucide-react';
import {
  PERMISSION,
  type GroupAuditFile,
  type GroupAuditFileSlot,
  type PackageDocumentKey,
  type StatutoryAuditGroupAudit,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker, VersionHistory } from './acceptance-file-card';

/**
 * Shared plumbing for the 02.6 Part B panels (group / component / branch
 * auditor framework): one query over `…/group-audit`, one mutation helper, and
 * the file slot every matrix row, package document and branch record uses —
 * Add File / Link Existing File / Open / Version History through the
 * engagement workspace (SharePoint when Microsoft 365 is on).
 */

export type GroupView = StatutoryAuditGroupAudit;
export type GroupAct = (fn: () => Promise<GroupView>, ok?: string) => Promise<boolean>;
export type GroupSend = (
  path: string,
  method: 'POST' | 'PATCH',
  body: object,
) => Promise<GroupView>;

export function groupAuditBase(engagementId: string, workflowInstanceId: string): string {
  return `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/group-audit`;
}

export function groupAuditKey(engagementId: string, workflowInstanceId: string): unknown[] {
  return ['engagement', engagementId, 'group-audit', workflowInstanceId];
}

/** The group-audit view, the mutation helper and whether this user can change it. */
export function useGroupAudit(
  engagementId: string,
  workflowInstanceId: string,
  canManage: boolean,
) {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const base = groupAuditBase(engagementId, workflowInstanceId);
  const key = groupAuditKey(engagementId, workflowInstanceId);
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<GroupView>(base) });
  const [busy, setBusy] = useState(false);
  // Leads change the file; the matrix itself only while 02.6 requires CFS.
  // Branch auditors (section 143(8)) apply with or without a CFS.
  const editable =
    !!q.data && canManage && !q.data.readOnly && can(principal, PERMISSION.engagementManage);
  const matrixEditable = editable && q.data?.matrixState === 'active';
  const act: GroupAct = async (fn, ok) => {
    setBusy(true);
    try {
      qc.setQueryData(key, await fn());
      // 02.6 landing / §24 checklist and Section 06 read the same state.
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'consolidation'] });
      void qc.invalidateQueries({ queryKey: [...key, 'work-programme'] });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the group audit.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send: GroupSend = (path, method, body) =>
    apiFetch<GroupView>(path ? `${base}/${path}` : base, { method, body });
  return { q, base, editable, matrixEditable, busy, act, send };
}

/** A text field saved on blur when it changed (empty → null). */
export function BlurField({
  label,
  value,
  onSave,
  disabled,
  type,
  placeholder,
  required,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
  disabled?: boolean;
  type?: 'text' | 'date';
  placeholder?: string;
  required?: boolean;
}): JSX.Element {
  const [v, setV] = useState(value ?? '');
  return (
    <Field label={label} required={required}>
      <Input
        type={type ?? 'text'}
        value={v}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v.trim() !== (value ?? '').trim()) onSave(v.trim() || null);
        }}
      />
    </Field>
  );
}

/**
 * One file slot. `needsReason` (approved package evidence) asks why before a
 * replacement — approved evidence is never silently replaced (spec §15).
 */
export function GroupFileSlot({
  engagementId,
  base,
  label,
  file,
  superseded = [],
  slot,
  ownerId,
  packageKey = null,
  editable,
  busy,
  act,
  needsReason = false,
  extra,
}: {
  engagementId: string;
  base: string;
  label: string;
  file: GroupAuditFile | null;
  superseded?: GroupAuditFile[];
  slot: GroupAuditFileSlot;
  ownerId: string;
  packageKey?: PackageDocumentKey | null;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  needsReason?: boolean;
  extra?: React.ReactNode;
}): JSX.Element {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [history, setHistory] = useState(false);
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [reason, setReason] = useState('');
  const replacing = !!file && needsReason;
  const blocked = replacing && !reason.trim();
  const target = {
    slot,
    ownerId,
    packageKey,
    replaceReason: replacing ? reason.trim() : null,
  };
  const openDoc = async (documentId: string) => {
    try {
      setDoc(await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the document.', 'error');
    }
  };
  return (
    <div className="space-y-1" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{label}</span>
        {file ? (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary-600 hover:underline"
              onClick={() => void openDoc(file.documentId)}
            >
              {file.filename ?? file.title} <ExternalLink className="h-3 w-3" />
            </button>
            <span className="text-ink-faint">
              v{file.versionNo} · {file.how} {formatDate(file.linkedAt)}
              {file.linkedByName ? ` · ${file.linkedByName}` : ''}
            </span>
            {file.inSharePoint && <Badge tone="info">SharePoint</Badge>}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-ink-faint hover:text-ink"
              aria-expanded={history}
              onClick={() => setHistory((o) => !o)}
            >
              <History className="h-3 w-3" /> Version history
            </button>
          </>
        ) : (
          <span className="text-ink-faint">Not added yet.</span>
        )}
        {extra}
      </div>
      {history && file && <VersionHistory base={`${base}/files`} fileId={file.id} />}
      {superseded.length > 0 && (
        <p className="text-ink-faint">
          Replaced:{' '}
          {superseded.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <button
                type="button"
                className="hover:underline"
                onClick={() => void openDoc(s.documentId)}
              >
                {s.filename ?? s.title}
              </button>
            </span>
          ))}
        </p>
      )}
      {editable && (
        <div className="space-y-1">
          {replacing && (
            <Field label="Reason for replacing approved evidence" required>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || blocked}
              onClick={() => input.current?.click()}
            >
              <FilePlus2 className="h-3.5 w-3.5" /> {file ? 'Replace — Add File' : 'Add File'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || blocked}
              aria-expanded={linking}
              onClick={() => setLinking((o) => !o)}
            >
              <Link2 className="h-3.5 w-3.5" /> Link Existing File
            </Button>
          </div>
          <input
            ref={input}
            type="file"
            className="hidden"
            aria-label={`Add a file — ${label}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              void (async () => {
                const ok = await act(
                  async () =>
                    apiFetch<GroupView>(`${base}/files/add`, {
                      method: 'POST',
                      body: {
                        ...target,
                        filename: f.name,
                        contentType: f.type || undefined,
                        contentBase64: await blobToBase64(f),
                      },
                    }),
                  'File added.',
                );
                if (ok) setReason('');
              })();
            }}
          />
          {linking && (
            <LinkPicker
              engagementId={engagementId}
              exclude={file ? [file.documentId] : []}
              onPick={async (documentId) => {
                const ok = await act(
                  () =>
                    apiFetch<GroupView>(`${base}/files/link`, {
                      method: 'POST',
                      body: { ...target, documentId },
                    }),
                  'File linked.',
                );
                if (ok) {
                  setLinking(false);
                  setReason('');
                }
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

/** The inline +/− row header used by components, branches and findings. */
export function ToggleHeader({
  open,
  onToggle,
  label,
  children,
  muted,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-sunken/50 ${muted ? 'opacity-60' : ''}`}
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
      onClick={onToggle}
    >
      {open ? (
        <Minus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      ) : (
        <Plus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      )}
      {children}
    </button>
  );
}
