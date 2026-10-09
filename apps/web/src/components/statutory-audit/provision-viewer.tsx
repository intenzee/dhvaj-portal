'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ExternalLink, History } from 'lucide-react';
import {
  AUTHORITY_REFERENCE_ACTION,
  type AuthorityProvisionRecord,
  type AuthorityReference,
} from '@hsdg/contracts';
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
  const [superseding, setSuperseding] = useState(false);
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
        {prov.authority} · version {prov.versionNo} · in force {formatDate(prov.effectiveFrom)}
        {prov.effectiveTo ? ` to ${formatDate(prov.effectiveTo)}` : ' onwards'}
        {prov.sourceReference ? ` · ${prov.sourceReference}` : ''}
      </p>
      {prov.supersededById && (
        <p className="text-warning-700">
          A later version applies from {formatDate(nextDay(prov.effectiveTo))} — this is the version
          in force for this engagement period.
        </p>
      )}
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
      <VersionHistoryToggle provision={prov} />
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
          {!prov.supersededById && (
            <button
              type="button"
              className="ml-3 text-primary-600 hover:underline"
              aria-expanded={superseding}
              onClick={() => setSuperseding((o) => !o)}
            >
              {superseding ? 'Cancel new version' : 'Supersede with a new version'}
            </button>
          )}
          {superseding && <SupersedeForm provision={prov} onDone={() => setSuperseding(false)} />}
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

const versionsKey = (code: string) => ['authority-references', 'versions', code];

function nextDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Every dated version of the provision (02.2 §20), newest first, expanding in place. */
function VersionHistoryToggle({
  provision: prov,
}: {
  provision: AuthorityProvisionRecord;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-primary-600 hover:underline"
      >
        <History className="h-3 w-3" /> {open ? 'Hide version history' : 'Version history'}
      </button>
      {open && <VersionList provision={prov} />}
    </div>
  );
}

function VersionList({ provision: prov }: { provision: AuthorityProvisionRecord }): JSX.Element {
  const q = useQuery({
    queryKey: versionsKey(prov.code),
    queryFn: () =>
      apiFetch<AuthorityProvisionRecord[]>(
        `/authority-provisions/${encodeURIComponent(prov.code)}/versions`,
      ),
  });
  if (q.isLoading) return <p className="mt-1 text-ink-faint">Loading versions…</p>;
  if (q.isError || !q.data)
    return <p className="mt-1 text-danger-700">Could not load the version history.</p>;
  return (
    <ol className="mt-1 space-y-1 border-l-2 border-line pl-2" aria-label="Version history">
      {q.data.map((v) => (
        <li key={v.id}>
          <span className="font-medium text-ink">
            Version {v.versionNo} · {v.provisionNumber} — {v.title}
          </span>
          {v.id === prov.id && <span className="ml-1 text-primary-600">(shown)</span>}
          <span className="block text-ink-faint">
            In force {formatDate(v.effectiveFrom)}
            {v.effectiveTo ? ` to ${formatDate(v.effectiveTo)}` : ' onwards'}
            {v.sourceReference ? ` · ${v.sourceReference}` : ''}
          </span>
          {v.changeNote && <span className="block text-ink-muted">{v.changeNote}</span>}
          {v.sourceUrl && v.id !== prov.id && (
            <a
              href={v.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-600 hover:underline"
            >
              Source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Methodology administration: supersede the current version with a new dated
 * one. Blank fields carry over; the current version closes the day before.
 */
function SupersedeForm({
  provision: prov,
  onDone,
}: {
  provision: AuthorityProvisionRecord;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [provisionNumber, setProvisionNumber] = useState('');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const badUrl = sourceUrl.trim() !== '' && !sourceUrl.trim().startsWith('https://');
  const tooEarly = effectiveFrom !== '' && effectiveFrom <= prov.effectiveFrom;
  const ready = effectiveFrom !== '' && !tooEarly && !badUrl && changeNote.trim() !== '';
  return (
    <form
      className="mt-1 space-y-2"
      aria-label="Supersede with a new version"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        try {
          const next = await apiFetch<AuthorityProvisionRecord>(
            `/authority-provisions/${prov.id}/supersede`,
            {
              method: 'POST',
              body: {
                effectiveFrom,
                provisionNumber: provisionNumber.trim() || null,
                title: title.trim() || null,
                sourceUrl: sourceUrl.trim() || null,
                summary: summary.trim() || null,
                changeNote: changeNote.trim(),
              },
            },
          );
          toast(`Version ${next.versionNo} in force from ${formatDate(next.effectiveFrom)}.`);
          void qc.invalidateQueries({ queryKey: ['engagement'] });
          void qc.invalidateQueries({ queryKey: ['authority-references'] });
          onDone();
        } catch (err) {
          toast(err instanceof ApiError ? err.message : 'Could not supersede.', 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-ink-muted">
        Adds version {prov.versionNo + 1}. Version {prov.versionNo} stays in force for earlier
        periods and closes the day before. Blank fields keep the current wording.
      </p>
      <Field label="In force from">
        <Input
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </Field>
      {tooEarly && (
        <p className="text-danger-700">It must start after {formatDate(prov.effectiveFrom)}.</p>
      )}
      <Field label={`Provision number (now: ${prov.provisionNumber})`}>
        <Input value={provisionNumber} onChange={(e) => setProvisionNumber(e.target.value)} />
      </Field>
      <Field label="Title">
        <Input value={title} placeholder={prov.title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Source link (https://)">
        <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      </Field>
      <Field label="Summary">
        <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="What changed">
        <Textarea rows={2} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
      </Field>
      <Button size="sm" type="submit" disabled={busy || !ready}>
        {busy ? 'Saving…' : 'Supersede'}
      </Button>
      {badUrl && <span className="ml-2 text-danger-700">The link must start with https://</span>}
    </form>
  );
}
