'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Archive, RotateCcw } from 'lucide-react';
import {
  DOCUMENT_TYPES,
  DOCUMENT_CLASSIFICATIONS,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Card, EmptyState, Badge, Button, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';

/** Read a File as base64 (without the data: prefix) + its content type. */
function readFileBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const result = String(reader.result);
      const base64 = result.slice(result.indexOf(',') + 1);
      resolve({ base64, contentType: file.type || 'application/octet-stream' });
    };
    reader.readAsDataURL(file);
  });
}

export function DocumentsSection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('working_paper');
  const [classification, setClassification] = useState('internal');

  const docs = useQuery({
    queryKey: ['engagement', engagementId, 'documents'],
    queryFn: () => apiFetch<Paginated<DocumentRow>>(`/engagements/${engagementId}/documents?limit=50`),
  });

  const invalidate = (): void =>
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'documents'] });

  const upload = useMutation({
    mutationFn: async () => {
      const { base64, contentType } = await readFileBase64(file!);
      return apiFetch(`/engagements/${engagementId}/documents`, {
        method: 'POST',
        body: {
          title: title.trim() || file!.name,
          documentType,
          classification,
          filename: file!.name,
          contentType,
          contentBase64: base64,
        },
      });
    },
    onSuccess: () => {
      toast('Document uploaded.');
      invalidate();
      setOpen(false);
      setFile(null);
      setTitle('');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'),
  });

  const archive = useMutation({
    mutationFn: (d: DocumentRow) =>
      apiFetch(`/engagements/${engagementId}/documents/${d.id}/${d.status === 'archived' ? 'restore' : 'archive'}`, {
        method: 'POST',
        body: { reason: d.status === 'archived' ? 'Restored' : 'Archived', version: d.version },
      }),
    onSuccess: (_r, d) => {
      toast(d.status === 'archived' ? 'Document restored.' : 'Document archived.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  const download = async (d: DocumentRow): Promise<void> => {
    try {
      await downloadFile(`/engagements/${engagementId}/documents/${d.id}/download`, d.currentFilename ?? d.title);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Documents</h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Upload
        </Button>
      </div>
      <Card className="overflow-hidden p-0">
        {docs.isLoading && <div className="p-5"><Spinner /></div>}
        {docs.data && docs.data.items.length === 0 && (
          <div className="p-5"><EmptyState>No documents uploaded yet.</EmptyState></div>
        )}
        {docs.data && docs.data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Title</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Classification</th>
                <th className="px-4 py-2.5 font-semibold">Ver</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {docs.data.items.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setPreview(d)}
                      className="block text-left font-medium text-primary-700 hover:underline"
                      title="Quick look"
                    >
                      {d.title}
                    </button>
                    <div className="text-xs text-ink-faint">{d.currentFilename}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{humanize(d.documentType)}</td>
                  <td className="px-4 py-2.5"><Badge>{humanize(d.classification)}</Badge></td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">v{d.currentVersionNo}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => void download(d)}
                        className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-primary-600"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => archive.mutate(d)}
                        disabled={archive.isPending}
                        className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
                        title={d.status === 'archived' ? 'Restore' : 'Archive'}
                      >
                        {d.status === 'archived' ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Upload document"
        description="Stored as versioned evidence; downloads are audited."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="File" required>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
              }}
              className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
            />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{humanize(t)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Classification">
              <Select value={classification} onChange={(e) => setClassification(e.target.value)}>
                {DOCUMENT_CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{humanize(c)}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Modal>

      {preview && (
        <DocumentPreview
          engagementId={engagementId}
          doc={preview}
          onClose={() => setPreview(null)}
          onSaved={invalidate}
        />
      )}
    </section>
  );
}
