'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

interface UploadLinkInfo {
  valid: boolean;
  requestedInfo: string | null;
  outstandingItems: string | null;
  entityName: string | null;
  engagementCode: string | null;
  expiresAt: string | null;
  uploadsRemaining: number | null;
}

function readFileBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        base64: result.slice(result.indexOf(',') + 1),
        contentType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * PUBLIC client upload page (no login). Reached via a tokenised magic link the
 * firm sends. Shows what's requested and lets the client upload files, which land
 * as client_shared documents on the right engagement. Nothing else is visible.
 */
export default function ClientUploadPage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<UploadLinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      const data = await apiFetch<UploadLinkInfo>(`/client-upload/${token}`);
      setInfo(data);
    } catch {
      setInfo({
        valid: false,
        requestedInfo: null,
        outstandingItems: null,
        entityName: null,
        engagementCode: null,
        expiresAt: null,
        uploadsRemaining: null,
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const upload = async (): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      let done = 0;
      for (const f of files) {
        const { base64, contentType } = await readFileBase64(f);
        await apiFetch(`/client-upload/${token}`, {
          method: 'POST',
          body: { filename: f.name, contentType, contentBase64: base64 },
        });
        done += 1;
      }
      setMessage({ kind: 'ok', text: `Uploaded ${done} file${done === 1 ? '' : 's'}. Thank you.` });
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
      await loadInfo();
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Upload failed. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-line-strong bg-surface p-6 shadow-pop">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-ink">Secure document upload</h1>
          <p className="text-sm text-ink-muted">Dhvaj Chartered Accountants</p>
        </div>

        {loading && <p className="text-sm text-ink-muted">Loading…</p>}

        {!loading && info && !info.valid && (
          <div className="rounded-lg bg-danger-50 p-4 text-sm text-danger-700">
            This upload link is invalid or has expired. Please contact your engagement team for a
            new link.
          </div>
        )}

        {!loading && info && info.valid && (
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-raised/60 p-4 text-sm">
              <p className="font-medium text-ink">
                {info.entityName ?? 'Your engagement'}
                {info.engagementCode ? ` · ${info.engagementCode}` : ''}
              </p>
              {info.requestedInfo && <p className="mt-1 text-ink">{info.requestedInfo}</p>}
              {info.outstandingItems && (
                <p className="mt-1 text-ink-muted">Outstanding: {info.outstandingItems}</p>
              )}
              <p className="mt-2 text-xs text-ink-faint">
                {info.expiresAt && `Link valid until ${new Date(info.expiresAt).toLocaleString()}`}
                {typeof info.uploadsRemaining === 'number' &&
                  ` · ${info.uploadsRemaining} upload(s) remaining`}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Choose file(s)</label>
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
              />
            </div>

            {message && (
              <div
                className={`rounded-lg p-3 text-sm ${
                  message.kind === 'ok'
                    ? 'bg-success-50 text-success-700'
                    : 'bg-danger-50 text-danger-700'
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="button"
              disabled={files.length === 0 || busy}
              onClick={() => void upload()}
              className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-primary-600/50"
            >
              {busy ? 'Uploading…' : `Upload${files.length > 0 ? ` ${files.length} file(s)` : ''}`}
            </button>

            <p className="text-center text-xs text-ink-faint">
              Files are transmitted securely to your engagement team. Do not share this link.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
