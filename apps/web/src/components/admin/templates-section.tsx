'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Plus, Upload } from 'lucide-react';
import {
  DEFAULT_TEMPLATE_VARIANT,
  DOCUMENT_TEMPLATE_DEFINITIONS,
  TEMPLATE_MERGE_FIELDS,
  type DocumentTemplateKey,
  type DocumentTemplateRecord,
  type DocumentTemplateVersionRecord,
  type TemplateConditions,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';

interface FirmSettings {
  firmName: string;
  frn: string | null;
  address: string | null;
  email: string | null;
  version: number;
}

const TEMPLATES_KEY = ['document-templates'];
const FIRM_KEY = ['firm-settings'];

/**
 * Firm document templates (Section 01 spec §2, §10.2): the approved DHVAJ Word
 * files "Create from Template" merges engagement data into. Upload a .docx (its
 * `{{merge.fields}}` are scanned), approve it to make it the version new files
 * use — earlier engagements keep the version they were created from. Variants
 * (e.g. a listed-company engagement letter) apply when their conditions hold.
 */
export function TemplatesSection(): JSX.Element {
  const templates = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: () => apiFetch<DocumentTemplateRecord[]>('/document-templates'),
  });
  return (
    <div className="space-y-6">
      <FirmDetails />
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Section 01 templates</h3>
          <p className="text-xs text-ink-muted">
            Until a template has an approved version, Create from Template explains that an administrator must upload
            one. Write merge fields in Word as <code className="font-mono">{'{{client.name}}'}</code>.
          </p>
        </div>
        {templates.isLoading ? (
          <Spinner label="Loading templates…" />
        ) : (
          DOCUMENT_TEMPLATE_DEFINITIONS.map((d) => (
            <TemplateGroup
              key={d.templateKey}
              templateKey={d.templateKey}
              title={d.title}
              variants={(templates.data ?? []).filter((t) => t.templateKey === d.templateKey)}
            />
          ))
        )}
        <AddVariant />
        <MergeFieldReference />
      </div>
    </div>
  );
}

function FirmDetails(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: FIRM_KEY, queryFn: () => apiFetch<FirmSettings>('/firm-settings') });
  const [form, setForm] = useState({ firmName: '', frn: '', address: '', email: '' });
  useEffect(() => {
    if (q.data)
      setForm({
        firmName: q.data.firmName,
        frn: q.data.frn ?? '',
        address: q.data.address ?? '',
        email: q.data.email ?? '',
      });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<FirmSettings>('/firm-settings', {
        method: 'PATCH',
        body: {
          firmName: form.firmName.trim(),
          frn: form.frn.trim() || null,
          address: form.address.trim() || null,
          email: form.email.trim() || null,
          version: q.data!.version,
        },
      }),
    onSuccess: (v) => {
      qc.setQueryData(FIRM_KEY, v);
      toast('Firm details saved.');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'),
  });
  if (q.isLoading) return <Spinner label="Loading firm details…" />;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">Firm details</h3>
        <p className="text-xs text-ink-muted">
          Merged into templates as <code className="font-mono">{'{{firm.name}}'}</code>,{' '}
          <code className="font-mono">{'{{firm.frn}}'}</code> and <code className="font-mono">{'{{firm.address}}'}</code>.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Firm name" required>
          <Input value={form.firmName} onChange={(e) => setForm({ ...form, firmName: e.target.value })} />
        </Field>
        <Field label="Firm registration number (FRN)">
          <Input value={form.frn} onChange={(e) => setForm({ ...form, frn: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Address">
          <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
      </div>
      <Button size="sm" type="submit" disabled={!form.firmName.trim() || save.isPending}>
        Save firm details
      </Button>
    </form>
  );
}

function conditionsText(c: TemplateConditions): string {
  const parts: string[] = [];
  if (c.listed !== undefined) parts.push(c.listed ? 'listed' : 'unlisted');
  if (c.hasGroup !== undefined) parts.push(c.hasGroup ? 'has a group' : 'no group');
  if (c.entityTypeSlugs?.length) parts.push(`entity type ${c.entityTypeSlugs.join(' / ')}`);
  return parts.length ? `Applies when ${parts.join(', ')}` : 'Default — applies when no other variant does';
}

function TemplateGroup({
  templateKey,
  title,
  variants,
}: {
  templateKey: DocumentTemplateKey;
  title: string;
  variants: DocumentTemplateRecord[];
}): JSX.Element {
  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line bg-surface-sunken/40 px-3 py-2 text-sm font-medium text-ink">{title}</div>
      <ul className="divide-y divide-line">
        {variants.length === 0 && <li className="px-3 py-2 text-xs text-ink-muted">No variants ({templateKey}).</li>}
        {variants.map((v) => (
          <VariantRow key={v.id} variant={v} />
        ))}
      </ul>
    </div>
  );
}

function VariantRow({ variant: v }: { variant: DocumentTemplateRecord }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState('');
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error');
  const done = () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY });

  const upload = useMutation({
    mutationFn: async (file: File) =>
      apiFetch<DocumentTemplateRecord>(`/document-templates/${v.id}/versions`, {
        method: 'POST',
        body: { filename: file.name, contentBase64: await blobToBase64(file), notes: notes.trim() || undefined },
      }),
    onSuccess: () => {
      setNotes('');
      done();
      toast('Uploaded as a draft — review the fields found, then approve it.');
    },
    onError,
  });
  const approve = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/document-templates/${v.id}/versions/${versionId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      done();
      toast('Approved — new files are created from this version.');
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: () =>
      apiFetch(`/document-templates/${v.id}`, { method: 'PATCH', body: { isActive: !v.isActive, version: v.version } }),
    onSuccess: done,
    onError,
  });
  const cur = v.currentVersion;

  return (
    <li className="px-3 py-2">
      <button
        type="button"
        className="group flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ExpandToggle open={open} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
            {v.title}
            <span className="font-mono text-[11px] text-ink-faint">{v.variantKey}</span>
            {!v.isActive && <Badge>Switched off</Badge>}
            {cur ? <Badge tone="success">Approved v{cur.versionNo}</Badge> : <Badge tone="warn">No approved file</Badge>}
            {v.versions.some((x) => x.status === 'draft') && <Badge tone="info">Draft awaiting approval</Badge>}
          </span>
          <span className="block text-[11px] text-ink-faint">{conditionsText(v.appliesWhen)}</span>
        </span>
      </button>
      <InlinePanel open={open} onClose={() => setOpen(false)} title={`${v.title} — versions`}>
        <div className="space-y-3">
          {v.versions.length === 0 ? (
            <p className="text-xs text-ink-muted">Nothing uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {v.versions.map((x) => (
                <VersionLine
                  key={x.id}
                  templateId={v.id}
                  x={x}
                  approving={approve.isPending}
                  onApprove={() => approve.mutate(x.id)}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <Field label="Notes for the new version (optional)">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            <Button size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" /> {upload.isPending ? 'Uploading…' : 'Upload .docx'}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              aria-label={`Upload a new version of ${v.title}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload.mutate(file);
              }}
            />
            {v.variantKey !== DEFAULT_TEMPLATE_VARIANT && (
              <Button size="sm" variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                {v.isActive ? 'Switch variant off' : 'Switch variant on'}
              </Button>
            )}
          </div>
        </div>
      </InlinePanel>
    </li>
  );
}

function VersionLine({
  templateId,
  x,
  approving,
  onApprove,
}: {
  templateId: string;
  x: DocumentTemplateVersionRecord;
  approving: boolean;
  onApprove: () => void;
}): JSX.Element {
  const toast = useToast();
  return (
    <li className="space-y-1 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">v{x.versionNo}</span>
          <span className="text-ink-muted">{x.filename}</span>
          <Badge tone={x.status === 'approved' ? 'success' : x.status === 'draft' ? 'info' : 'neutral'}>
            {x.status === 'approved' ? 'Approved' : x.status === 'draft' ? 'Draft' : 'Superseded'}
          </Badge>
        </span>
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void downloadFile(`/document-templates/${templateId}/versions/${x.id}/download`, x.filename).catch(
                (e: unknown) => toast(e instanceof ApiError ? e.message : 'Download failed.', 'error'),
              )
            }
          >
            <Download className="h-4 w-4" /> Download
          </Button>
          {x.status === 'draft' && (
            <Button size="sm" disabled={approving} onClick={onApprove}>
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
          )}
        </span>
      </div>
      <p className="text-[11px] text-ink-faint">
        Uploaded by {x.uploadedByName ?? '—'} on {formatDate(x.uploadedAt)}
        {x.approvedAt ? ` · approved by ${x.approvedByName ?? '—'} on ${formatDate(x.approvedAt)}` : ''}
        {x.notes ? ` · ${x.notes}` : ''}
      </p>
      <p className="text-[11px] text-ink-muted">
        Fields: {x.fieldsFound.length ? x.fieldsFound.join(', ') : 'none found'}
      </p>
      {x.unknownFields.length > 0 && (
        <p className="text-[11px] text-warning-700">
          Not recognised (left as written): {x.unknownFields.join(', ')}
        </p>
      )}
    </li>
  );
}

function AddVariant(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState<DocumentTemplateKey>(DOCUMENT_TEMPLATE_DEFINITIONS[0]!.templateKey);
  const [variantKey, setVariantKey] = useState('');
  const [title, setTitle] = useState('');
  const [listed, setListed] = useState('');
  const [hasGroup, setHasGroup] = useState('');
  const [entityTypes, setEntityTypes] = useState('');
  const create = useMutation({
    mutationFn: () => {
      const appliesWhen: TemplateConditions = {};
      if (listed) appliesWhen.listed = listed === 'yes';
      if (hasGroup) appliesWhen.hasGroup = hasGroup === 'yes';
      const slugs = entityTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (slugs.length) appliesWhen.entityTypeSlugs = slugs;
      return apiFetch('/document-templates', {
        method: 'POST',
        body: { templateKey, variantKey: variantKey.trim(), title: title.trim() || undefined, appliesWhen },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
      setOpen(false);
      setVariantKey('');
      setTitle('');
      setListed('');
      setHasGroup('');
      setEntityTypes('');
      toast('Variant added — upload and approve its file.');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'),
  });
  const validKey = /^[a-z0-9_]{2,40}$/.test(variantKey.trim());
  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus className="h-4 w-4" /> Add variant
      </Button>
      <InlinePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Add a template variant"
        description="E.g. a listed-company engagement letter. The most specific variant whose conditions hold is used."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template" required>
            <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value as DocumentTemplateKey)}>
              {DOCUMENT_TEMPLATE_DEFINITIONS.map((d) => (
                <option key={d.templateKey} value={d.templateKey}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Variant key" required hint="Lowercase letters, digits and _ (e.g. listed_company).">
            <Input value={variantKey} onChange={(e) => setVariantKey(e.target.value)} />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Listed company">
            <Select value={listed} onChange={(e) => setListed(e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Listed</option>
              <option value="no">Unlisted</option>
            </Select>
          </Field>
          <Field label="Group (subsidiaries / associates / JVs)">
            <Select value={hasGroup} onChange={(e) => setHasGroup(e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Has a group</option>
              <option value="no">No group</option>
            </Select>
          </Field>
          <Field label="Entity types" hint="Comma-separated entity-type slugs, e.g. public_limited.">
            <Input value={entityTypes} onChange={(e) => setEntityTypes(e.target.value)} />
          </Field>
        </div>
        <Button className="mt-3" size="sm" disabled={!validKey || create.isPending} onClick={() => create.mutate()}>
          Add variant
        </Button>
      </InlinePanel>
    </div>
  );
}

function MergeFieldReference(): JSX.Element {
  return (
    <details className="rounded-lg border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-ink">Merge fields reference</summary>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left text-ink-faint">
          <tr>
            <th className="py-1 font-medium">Field</th>
            <th className="py-1 font-medium">Meaning</th>
            <th className="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {TEMPLATE_MERGE_FIELDS.map((f) => (
            <tr key={f.key}>
              <td className="py-1 font-mono text-ink">{`{{${f.key}}}`}</td>
              <td className="py-1 text-ink-muted">{f.label}</td>
              <td className="py-1 text-ink-muted">{f.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-ink-faint">
        A field with no value is shown as [Label] in the created file so it is easy to spot and complete.
      </p>
    </details>
  );
}
