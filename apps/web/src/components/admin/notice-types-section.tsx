'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  NOTICE_STREAMS,
  NOTICE_STREAM_LABEL,
  type NoticeStream,
  type NoticeType,
  type UpsertNoticeTypeRequest,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { noticeTypesKey, noticeTypesQuery, upsertNoticeType } from '@/lib/notices-api';
import { useToast } from '@/lib/toast';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui';

/**
 * Admin → Notice types (PS-101): the library the stream leads maintain — form,
 * section, title, the default days to reply, and whether an order is appealable
 * (and under which limitation rule). workflow.manage; every change is audited.
 */
export function NoticeTypesSection(): JSX.Element {
  const q = useQuery(noticeTypesQuery);
  const [editing, setEditing] = useState<NoticeType | 'new' | null>(null);
  const types = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Notice types</h2>
          <p className="text-sm text-ink-muted">
            The notices the firm records, by stream. The default reply days pre-fill a new
            notice&rsquo;s reply date; an appealable type starts the appeal clock when its order is
            recorded.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add type
        </Button>
      </div>
      {q.isLoading && <Spinner />}
      {q.isError && <EmptyState>Could not load the notice types.</EmptyState>}
      {q.data && types.length === 0 && <EmptyState>No notice types yet.</EmptyState>}
      {NOTICE_STREAMS.map((s) => {
        const rows = types.filter((t) => t.stream === s);
        if (rows.length === 0) return null;
        return (
          <div key={s}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {NOTICE_STREAM_LABEL[s]}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2 font-semibold">Code</th>
                    <th className="px-3 py-2 font-semibold">Form · section · title</th>
                    <th className="px-3 py-2 font-semibold">Reply days</th>
                    <th className="px-3 py-2 font-semibold">Appeal</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.code} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{t.code}</td>
                      <td className="px-3 py-2">
                        {[t.form, t.section, t.title].filter(Boolean).join(' · ')}
                        {!t.isActive && (
                          <Badge className="ml-2" tone="neutral">
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{t.defaultReplyDays ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {t.appealable ? (
                          (t.appealRuleCode ?? 'Appealable')
                        ) : (
                          <span className="text-ink-faint">No</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {editing && (
        <NoticeTypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function NoticeTypeModal({
  type,
  onClose,
}: {
  type: NoticeType | null;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState(type?.code ?? '');
  const [stream, setStream] = useState<NoticeStream>(type?.stream ?? 'gst');
  const [form, setForm] = useState(type?.form ?? '');
  const [section, setSection] = useState(type?.section ?? '');
  const [title, setTitle] = useState(type?.title ?? '');
  const [days, setDays] = useState(
    type?.defaultReplyDays != null ? String(type.defaultReplyDays) : '',
  );
  const [appealable, setAppealable] = useState(type?.appealable ?? false);
  const [rule, setRule] = useState(type?.appealRuleCode ?? '');
  const [active, setActive] = useState(type?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body: UpsertNoticeTypeRequest = {
        stream,
        form: form.trim() || null,
        section: section.trim() || null,
        title: title.trim(),
        defaultReplyDays: days.trim() ? Number(days) : null,
        appealable,
        appealRuleCode: appealable && rule.trim() ? rule.trim() : null,
        isActive: active,
        ...(type ? { version: type.version } : {}),
      };
      return upsertNoticeType(code.trim(), body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: noticeTypesKey });
      toast(type ? 'Notice type saved.' : 'Notice type added.');
      onClose();
    },
    onError: (err) =>
      toast(
        err instanceof ApiError && err.status === 409
          ? 'Someone else changed this type — close and reopen it.'
          : err instanceof Error
            ? err.message
            : 'Could not save.',
        'error',
      ),
  });
  const badDays = days.trim() !== '' && !(Number.isInteger(Number(days)) && Number(days) >= 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={type ? `Edit ${type.code}` : 'Add notice type'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!code.trim() || !title.trim() || badDays || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Code"
          required
          hint={type ? undefined : 'e.g. GST_ASMT_10. Cannot change later.'}
        >
          <Input
            value={code}
            disabled={!!type}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Stream" required>
          <Select value={stream} onChange={(e) => setStream(e.target.value as NoticeStream)}>
            {NOTICE_STREAMS.map((s) => (
              <option key={s} value={s}>
                {NOTICE_STREAM_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Form">
          <Input value={form} onChange={(e) => setForm(e.target.value)} placeholder="ASMT-10" />
        </Field>
        <Field label="Section">
          <Input value={section} onChange={(e) => setSection(e.target.value)} placeholder="s.61" />
        </Field>
        <Field label="Title" required className="col-span-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Scrutiny of returns"
          />
        </Field>
        <Field label="Default days to reply" hint={badDays ? 'A whole number of days.' : undefined}>
          <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
          Active
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={appealable}
            onChange={(e) => setAppealable(e.target.checked)}
          />{' '}
          An order of this type can be appealed
        </label>
        {appealable && (
          <Field
            label="Appeal limitation rule"
            className="col-span-2"
            hint="The compliance rule an order starts, e.g. GST_APPEAL_LIMITATION."
          >
            <Input value={rule} onChange={(e) => setRule(e.target.value.toUpperCase())} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
