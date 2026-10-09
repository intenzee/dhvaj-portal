'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, ExternalLink } from 'lucide-react';
import { AUTHORITY_REFERENCE_ACTION, type AuthorityReference } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Field, Input, Textarea } from '@/components/form';

/**
 * The in-portal View Provision / View Standard / View Guidance viewer (02.1 §3,
 * §19; 02.2 §20). A reference resolves through the central Authority /
 * Provision Library — no screen names a URL — and opens in place: the
 * provision, the version in force, its summary and the MCA / ICAI source.
 * Methodology administrators maintain the summary and source link here.
 */

export function ReferenceLink({
  reference,
  canAdmin,
}: {
  reference: AuthorityReference;
  canAdmin: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const prov = reference.provision;
  const action = prov ? AUTHORITY_REFERENCE_ACTION[prov.referenceKind] : 'View Provision';
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-left text-xs font-medium text-primary-600 hover:underline"
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        {action} — {reference.label}
      </button>
      {open && <ProvisionViewer reference={reference} canAdmin={canAdmin} />}
    </div>
  );
}

export function ProvisionViewer({
  reference,
  canAdmin,
}: {
  reference: AuthorityReference;
  canAdmin: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const prov = reference.provision;
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(prov?.summary ?? '');
  const [sourceUrl, setSourceUrl] = useState(prov?.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);
  if (!prov) {
    return (
      <p className="mt-1 rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        The library holds no version of {reference.code} in force for this engagement period.
      </p>
    );
  }
  const badUrl = sourceUrl.trim() !== '' && !sourceUrl.trim().startsWith('https://');
  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-line bg-surface-sunken/60 px-3 py-2 text-xs">
      <p className="font-semibold text-ink">
        {prov.provisionNumber} — {prov.title}
      </p>
      <p className="text-ink-faint">
        {prov.authority} · in force {formatDate(prov.effectiveFrom)}
        {prov.effectiveTo ? ` to ${formatDate(prov.effectiveTo)}` : ' onwards'}
        {prov.sourceReference ? ` · ${prov.sourceReference}` : ''}
      </p>
      <p className="whitespace-pre-line text-ink-muted">
        {prov.summary ?? 'No summary maintained yet.'}
      </p>
      {prov.sourceUrl ? (
        <a
          href={prov.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary-600 hover:underline"
        >
          Open the {prov.authority} source <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <p className="text-ink-faint">No source link maintained yet.</p>
      )}
      {canAdmin && (
        <div>
          <button
            type="button"
            className="text-primary-600 hover:underline"
            aria-expanded={editing}
            onClick={() => setEditing((o) => !o)}
          >
            {editing ? 'Close' : 'Maintain viewer content'}
          </button>
          {editing && (
            <form
              className="mt-1 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (badUrl) return;
                setBusy(true);
                try {
                  await apiFetch(`/authority-provisions/${prov.id}`, {
                    method: 'PATCH',
                    body: { summary: summary.trim() || null, sourceUrl: sourceUrl.trim() || null },
                  });
                  toast('Provision content saved.');
                  setEditing(false);
                  void qc.invalidateQueries({ queryKey: ['engagement'] });
                  void qc.invalidateQueries({ queryKey: ['authority-references'] });
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : 'Could not save.', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Summary">
                <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </Field>
              <Field label="Source link (https://)">
                <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
              </Field>
              <Button size="sm" type="submit" disabled={busy || badUrl}>
                Save content
              </Button>
              {badUrl && (
                <span className="ml-2 text-danger-700">The link must start with https://</span>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
