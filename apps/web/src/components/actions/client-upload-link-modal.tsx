'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Ban } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Modal } from '@/components/modal';
import { Button, Spinner, EmptyState, Badge } from '@/components/ui';

interface UploadLink {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  uploadsUsed: number;
  maxUploads: number | null;
}
interface UploadLinkCreated extends UploadLink {
  token: string;
}

/**
 * Staff modal to mint / revoke secure client upload links for a client
 * dependency. The raw link is shown ONCE on creation (copy it to send); it is
 * never retrievable again.
 */
export function ClientUploadLinkModal({
  engagementId,
  dependencyId,
  requestedInfo,
  onClose,
}: {
  engagementId: string;
  dependencyId: string;
  requestedInfo: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const key = ['engagement', engagementId, 'client-dependencies', dependencyId, 'upload-links'];
  const base = `/engagements/${engagementId}/client-dependencies/${dependencyId}/upload-links`;

  const links = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<UploadLink[]>(base),
  });
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () => apiFetch<UploadLinkCreated>(base, { method: 'POST', body: {} }),
    onSuccess: (link) => {
      setFreshUrl(`${window.location.origin}/client-upload/${link.token}`);
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create link.', 'error'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      toast('Link revoked.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not revoke.', 'error'),
  });

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied.');
    } catch {
      toast('Copy failed — select and copy manually.', 'error');
    }
  };

  const items = links.data ?? [];
  const status = (l: UploadLink): { label: string; tone: 'success' | 'neutral' | 'danger' } => {
    if (l.revokedAt) return { label: 'Revoked', tone: 'danger' };
    if (new Date(l.expiresAt).getTime() <= Date.now()) return { label: 'Expired', tone: 'neutral' };
    return { label: 'Active', tone: 'success' };
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Client upload link"
      description={`Give the client a secure, expiring, upload-only link for: ${requestedInfo}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            <Link2 className="h-4 w-4" /> {create.isPending ? 'Creating…' : 'Create link'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {freshUrl && (
          <div className="rounded-lg border border-primary-500/40 bg-primary-50 p-3">
            <p className="mb-1 text-xs font-medium text-primary-700">
              New link — copy it now, it won&apos;t be shown again:
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={freshUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
              />
              <Button size="sm" onClick={() => void copy(freshUrl)}>
                <Copy className="h-4 w-4" /> Copy
              </Button>
            </div>
          </div>
        )}

        {links.isLoading && <Spinner />}
        {links.isSuccess && items.length === 0 && !freshUrl && (
          <EmptyState>No links yet. Create one to share with the client.</EmptyState>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((l) => {
              const s = status(l);
              return (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <span className="min-w-0 flex-1 text-ink-muted">
                    Expires {formatDate(l.expiresAt)} · {l.uploadsUsed}
                    {l.maxUploads ? `/${l.maxUploads}` : ''} uploaded
                  </span>
                  {!l.revokedAt && (
                    <button
                      type="button"
                      onClick={() => revoke.mutate(l.id)}
                      disabled={revoke.isPending}
                      className="rounded p-1.5 text-ink-muted hover:bg-danger-50 hover:text-danger-600"
                      title="Revoke"
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
