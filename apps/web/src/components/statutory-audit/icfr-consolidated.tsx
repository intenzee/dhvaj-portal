'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  ICFR_COMPONENT_AUDITOR_LABEL,
  ICFR_COMPONENT_AUDITORS,
  ICFR_COMPONENT_ICFR,
  ICFR_COMPONENT_ICFR_LABEL,
  ICFR_COMPONENT_MATERIALITY,
  ICFR_COMPONENT_MATERIALITY_LABEL,
  ICFR_CONSOLIDATED_STATE_LABEL,
  ICFR_PARENT_CONCLUSION_LABEL,
  ICFR_PARENT_CONCLUSIONS,
  PERMISSION,
  type IcfrComponent,
  type IcfrComponentIcfr,
  type IcfrParentConclusion,
  type StatutoryAuditIcfrConsolidated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/**
 * Consolidated ICFR reporting consideration (DHVAJ 02.5 spec §17). Exists only
 * while 02.6 puts consolidated financial statements in scope; the components
 * come from the 02.6 perimeter (subsidiaries, associates, joint ventures) and
 * the team may add one. For each: is it an Indian company, does section
 * 143(3)(i) apply to it, who audits it, its report and any material weakness.
 * The server suggests the parent conclusion; the Engagement Partner concludes.
 * Never blocks the standalone 02.5 conclusion.
 */

type View = StatutoryAuditIcfrConsolidated;
type Act = (fn: () => Promise<View>, ok?: string) => Promise<boolean>;

export function IcfrConsolidated({
  engagementId,
  workflowInstanceId,
  canManage = true,
}: {
  engagementId: string;
  workflowInstanceId: string;
  /** The host's own edit gate; the server decides too. */
  canManage?: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/icfr/consolidated`;
  const key = ['engagement', engagementId, 'icfr-consolidated', workflowInstanceId];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<View>(base) });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');

  if (q.isLoading) return <Spinner label="Loading the consolidated ICFR consideration…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError
          ? q.error.message
          : 'Could not load the consolidated ICFR consideration.'}
      </p>
    );
  }
  const view = q.data;
  const active = view.state === 'active';
  const editable =
    active && canManage && !view.readOnly && can(principal, PERMISSION.engagementManage);
  const act: Act = async (fn, ok) => {
    setBusy(true);
    try {
      qc.setQueryData(key, await fn());
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'icfr'] });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the consideration.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = (path: string, method: 'POST' | 'PATCH', body: object) =>
    apiFetch<View>(`${base}/${path}`, { method, body });
  const s = view.summary;
  const c = view.consolidated;

  return (
    <section className="space-y-3" aria-label="Consolidated ICFR consideration">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">Consolidated ICFR reporting</h4>
        <Badge tone={active ? 'info' : view.state === 'pending' ? 'warn' : 'neutral'}>
          {ICFR_CONSOLIDATED_STATE_LABEL[view.state]}
        </Badge>
        {c?.parentConclusion && (
          <Badge tone={c.parentConclusion === 'unmodified' ? 'success' : 'danger'}>
            {ICFR_PARENT_CONCLUSION_LABEL[c.parentConclusion]}
          </Badge>
        )}
      </div>
      <p className="text-xs text-ink-muted">{view.reason}</p>
      {view.components.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Consolidated summary">
          <Badge>{s.components} components</Badge>
          <Badge tone="info">{s.indianCompanies} Indian companies</Badge>
          {s.pending > 0 && <Badge tone="warn">{s.pending} pending</Badge>}
          {s.materialWeaknesses > 0 && (
            <Badge tone="danger">{s.materialWeaknesses} with a material weakness</Badge>
          )}
        </div>
      )}

      {view.components.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {view.components.map((m) => (
            <ComponentRow
              key={m.id}
              m={m}
              editable={editable && !m.withdrawn}
              busy={busy}
              act={act}
              send={send}
            />
          ))}
        </ul>
      )}

      {editable && (
        <>
          <Button size="sm" variant="secondary" onClick={() => setAdding((o) => !o)}>
            <Plus className="h-3.5 w-3.5" /> Add component
          </Button>
          {adding && (
            <div className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-2">
              <Field label="Component" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Relationship">
                <Input
                  value={relationship}
                  placeholder="Subsidiary / associate / joint venture"
                  onChange={(e) => setRelationship(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  disabled={busy || !name.trim()}
                  onClick={async () => {
                    const ok = await act(
                      () =>
                        send('components', 'POST', {
                          componentName: name.trim(),
                          relationship: relationship.trim() || null,
                        }),
                      'Component added.',
                    );
                    if (ok) {
                      setAdding(false);
                      setName('');
                      setRelationship('');
                    }
                  }}
                >
                  Add component
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {c && <ParentConclusion view={view} editable={editable} busy={busy} act={act} send={send} />}
    </section>
  );
}

function ComponentRow({
  m,
  editable,
  busy,
  act,
  send,
}: {
  m: IcfrComponent;
  editable: boolean;
  busy: boolean;
  act: Act;
  send: (path: string, method: 'POST' | 'PATCH', body: object) => Promise<View>;
}): JSX.Element {
  const [mwDetails, setMwDetails] = useState(m.materialWeaknessDetails ?? '');
  const [auditorName, setAuditorName] = useState(m.auditorName ?? '');
  const [materialityNote, setMaterialityNote] = useState(m.materialityNote ?? '');
  const patch = (body: object, ok?: string) =>
    act(() => send(`components/${m.id}`, 'PATCH', { ...body, version: m.version }), ok);
  const indian = m.indianCompany === 'yes';
  return (
    <li className="space-y-2 px-3 py-2 text-xs" aria-label={`Component ${m.componentName}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{m.componentName}</span>
        {m.relationship && <span className="text-ink-faint">{m.relationship}</span>}
        <Badge>{m.source === '02.6' ? 'From 02.6' : 'Added by the team'}</Badge>
        {indian && (
          <Badge tone={m.componentIcfr === 'pending' ? 'warn' : 'info'}>
            ICFR {ICFR_COMPONENT_ICFR_LABEL[m.componentIcfr]}
          </Badge>
        )}
        {m.materialWeakness && <Badge tone="danger">Material weakness</Badge>}
        {m.withdrawn && <Badge>Withdrawn</Badge>}
      </div>
      {m.missing.length > 0 && !m.withdrawn && (
        <p className="text-warning-700">Still needed: {m.missing.join(' ')}</p>
      )}
      {m.materialWeaknessDetails && !editable && (
        <p className="text-ink-muted">{m.materialWeaknessDetails}</p>
      )}
      {editable && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Indian company">
            <Select
              value={m.indianCompany ?? ''}
              disabled={busy}
              onChange={(e) => void patch({ indianCompany: e.target.value || null })}
            >
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
          {indian && (
            <>
              <Field label="Section 143(3)(i) for the component">
                <Select
                  value={m.componentIcfr}
                  disabled={busy}
                  onChange={(e) =>
                    void patch({ componentIcfr: e.target.value as IcfrComponentIcfr })
                  }
                >
                  {ICFR_COMPONENT_ICFR.map((x) => (
                    <option key={x} value={x}>
                      {ICFR_COMPONENT_ICFR_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Auditor">
                <Select
                  value={m.auditor ?? ''}
                  disabled={busy}
                  onChange={(e) => void patch({ auditor: e.target.value || null })}
                >
                  <option value="">—</option>
                  {ICFR_COMPONENT_AUDITORS.map((x) => (
                    <option key={x} value={x}>
                      {ICFR_COMPONENT_AUDITOR_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              {m.auditor === 'other' && (
                <Field label="Auditor name">
                  <Input
                    value={auditorName}
                    onChange={(e) => setAuditorName(e.target.value)}
                    onBlur={() =>
                      auditorName !== (m.auditorName ?? '') &&
                      void patch({ auditorName: auditorName.trim() || null })
                    }
                  />
                </Field>
              )}
              <Field label="Significance to the group">
                <Select
                  value={m.materiality ?? ''}
                  disabled={busy}
                  onChange={(e) => void patch({ materiality: e.target.value || null })}
                >
                  <option value="">—</option>
                  {ICFR_COMPONENT_MATERIALITY.map((x) => (
                    <option key={x} value={x}>
                      {ICFR_COMPONENT_MATERIALITY_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Significance — basis">
                <Input
                  value={materialityNote}
                  onChange={(e) => setMaterialityNote(e.target.value)}
                  onBlur={() =>
                    materialityNote !== (m.materialityNote ?? '') &&
                    void patch({ materialityNote: materialityNote.trim() || null })
                  }
                />
              </Field>
              <Field label="Material weakness reported">
                <Select
                  value={m.materialWeakness == null ? '' : m.materialWeakness ? 'yes' : 'no'}
                  disabled={busy}
                  onChange={(e) =>
                    void patch({
                      materialWeakness: e.target.value === '' ? null : e.target.value === 'yes',
                    })
                  }
                >
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              {m.materialWeakness && (
                <div className="sm:col-span-2">
                  <Field label="Material weakness — details">
                    <Input
                      value={mwDetails}
                      onChange={(e) => setMwDetails(e.target.value)}
                      onBlur={() =>
                        mwDetails !== (m.materialWeaknessDetails ?? '') &&
                        void patch({ materialWeaknessDetails: mwDetails.trim() || null })
                      }
                    />
                  </Field>
                </div>
              )}
            </>
          )}
          {m.source === 'manual' && (
            <div className="flex items-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void patch({ withdrawn: true }, 'Component withdrawn.')}
              >
                Withdraw
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ParentConclusion({
  view,
  editable,
  busy,
  act,
  send,
}: {
  view: View;
  editable: boolean;
  busy: boolean;
  act: Act;
  send: (path: string, method: 'POST' | 'PATCH', body: object) => Promise<View>;
}): JSX.Element {
  const c = view.consolidated!;
  const [conclusion, setConclusion] = useState<IcfrParentConclusion | ''>(
    c.parentConclusion ?? view.suggestedConclusion ?? '',
  );
  const [note, setNote] = useState(c.parentConclusionNote ?? '');
  return (
    <div className="space-y-1.5" aria-label="Consolidated ICFR conclusion">
      <h5 className="text-xs font-semibold text-ink">Conclusion for the consolidated report</h5>
      {c.parentConclusion ? (
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink">
            {ICFR_PARENT_CONCLUSION_LABEL[c.parentConclusion]}
          </span>
          {c.parentConclusionNote ? ` — ${c.parentConclusionNote}` : ''} ·{' '}
          {c.concludedByName ?? '—'} {c.concludedAt ? formatDate(c.concludedAt) : ''}
        </p>
      ) : (
        <>
          {view.suggestedConclusion && (
            <p className="text-xs text-ink-muted">
              Suggested from the components:{' '}
              {ICFR_PARENT_CONCLUSION_LABEL[view.suggestedConclusion]}
            </p>
          )}
          {view.conclusionBlockers.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-warning-700">
              {view.conclusionBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {editable &&
        (c.parentConclusion ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () => send('conclusion', 'POST', { parentConclusion: null, version: c.version }),
                'Conclusion reopened.',
              )
            }
          >
            Reopen conclusion
          </Button>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[18rem_1fr_auto] sm:items-end">
            <Field label="Conclusion">
              <Select
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value as IcfrParentConclusion)}
              >
                <option value="">—</option>
                {ICFR_PARENT_CONCLUSIONS.map((x) => (
                  <option key={x} value={x}>
                    {ICFR_PARENT_CONCLUSION_LABEL[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button
              size="sm"
              disabled={busy || !conclusion}
              onClick={() =>
                void act(
                  () =>
                    send('conclusion', 'POST', {
                      parentConclusion: conclusion,
                      note: note.trim() || null,
                      version: c.version,
                    }),
                  'Consolidated ICFR concluded.',
                )
              }
            >
              Conclude (Engagement Partner)
            </Button>
          </div>
        ))}
    </div>
  );
}
