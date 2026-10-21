'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, RotateCcw, Upload } from 'lucide-react';
import {
  HR_DOCUMENT_KINDS,
  HR_DOCUMENT_KIND_LABEL,
  type HrDocument,
  type HrDocumentKind,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { useToast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Badge, Button, Card, CardBody, EmptyState, Spinner } from '@/components/ui';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The person's HR documents (offer, appointment, deed, NDA, IDs). HR and the MP only. */
export function HrDocumentsTab({ employeeId }: { employeeId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [uploading, setUploading] = useState(false);
  const key = ['people', 'hr-documents', employeeId, showArchived];
  const docs = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<HrDocument[]>(
        `/people/employees/${employeeId}/documents${showArchived ? '?archived=true' : ''}`,
      ),
  });
  const toggle = useMutation({
    mutationFn: (d: HrDocument) =>
      apiFetch(
        `/people/employees/${employeeId}/documents/${d.id}/${d.archivedAt ? 'restore' : 'archive'}`,
        { method: 'POST' },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['people', 'hr-documents', employeeId] }),
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not change it.', 'error'),
  });
  const download = (d: HrDocument): void => {
    downloadFile(`/people/employees/${employeeId}/documents/${d.id}/download`, d.filename).catch(
      () => toast('Could not download the file.', 'error'),
    );
  };

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            Kept in the HR vault: only HR and the Managing Partner can open these. Every download is
            recorded.
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            <Button size="sm" onClick={() => setUploading(true)}>
              <Upload className="h-4 w-4" /> Add a file
            </Button>
          </div>
        </div>
        {docs.isLoading && <Spinner label="Loading the vault…" />}
        {docs.isError && <EmptyState>Could not load the vault.</EmptyState>}
        {docs.data && docs.data.length === 0 && <EmptyState>No HR documents yet.</EmptyState>}
        {docs.data && docs.data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint">
                <th className="pb-1 font-medium">Document</th>
                <th className="pb-1 font-medium">Kind</th>
                <th className="pb-1 font-medium">Added</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-2">
                    <span className="block font-medium text-ink">{d.title}</span>
                    <span className="block text-xs text-ink-faint">
                      {d.filename} · {size(d.sizeBytes)}
                      {d.note ? ` · ${d.note}` : ''}
                    </span>
                  </td>
                  <td className="py-2">
                    {HR_DOCUMENT_KIND_LABEL[d.kind]}
                    {d.archivedAt && (
                      <Badge tone="neutral" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 text-ink-muted">
                    {formatDate(d.createdAt)}
                    {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => download(d)}>
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(d)}
                    >
                      {d.archivedAt ? (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </>
                      ) : (
                        <>
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      {uploading && <UploadModal employeeId={employeeId} onClose={() => setUploading(false)} />}
    </Card>
  );
}

function UploadModal({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<HrDocumentKind>('appointment_letter');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const upload = useMutation({
    mutationFn: async () => {
      const f = file!;
      return apiFetch<HrDocument>(`/people/employees/${employeeId}/documents`, {
        method: 'POST',
        body: {
          kind,
          title: title.trim() || HR_DOCUMENT_KIND_LABEL[kind],
          filename: f.name,
          contentType: f.type || undefined,
          contentBase64: await blobToBase64(f),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
    },
    onSuccess: () => {
      toast('Added to the vault.');
      void qc.invalidateQueries({ queryKey: ['people', 'hr-documents', employeeId] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not add the file.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add to the HR vault"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? 'Uploading…' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Kind" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as HrDocumentKind)}>
            {HR_DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {HR_DOCUMENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" hint="Blank: the kind.">
          <Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="File" required>
          <input
            ref={fileRef}
            type="file"
            className="block text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Note">
          <Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
