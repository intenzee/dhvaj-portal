'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Users } from 'lucide-react';
import type {
  IndependenceDeclarationRow,
  RecordIndependenceDeclarationInput,
  StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Badge, Button } from '@/components/ui';
import { Textarea } from '@/components/form';

/**
 * 01.5 Team Independence (spec §8): a system-generated summary of the
 * declarations the team has given for this audit file — the Manager never
 * re-enters them — plus the signed-in person's own declaration.
 */

const STATUS_LABEL: Record<IndependenceDeclarationRow['status'], string> = {
  pending: 'Pending',
  independent: 'Independent',
  threat_disclosed: 'Threat disclosed',
};
const STATUS_TONE: Record<IndependenceDeclarationRow['status'], string> = {
  pending: 'warn',
  independent: 'success',
  threat_disclosed: 'danger',
};

export function TeamIndependence({ acc }: { acc: StatutoryAuditAcceptance }): JSX.Element {
  const ind = acc.context.independence;
  const [showTeam, setShowTeam] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Users className="h-4 w-4 text-ink-faint" aria-hidden />
          Team Independence
        </p>
        <Button size="sm" variant="ghost" onClick={() => setShowTeam((v) => !v)}>
          {showTeam ? 'Hide Team Declarations' : 'View Team Declarations'}
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ['Required declarations', ind.required],
            ['Completed', ind.completed],
            ['Pending', ind.pending],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-md bg-surface-sunken px-2 py-1.5">
            <dt className="text-[11px] text-ink-faint">{label}</dt>
            <dd className="text-sm font-semibold text-ink">{n}</dd>
          </div>
        ))}
      </dl>
      {ind.threatsDisclosed > 0 && (
        <p className="text-xs text-danger-700">
          {ind.threatsDisclosed} declaration(s) disclose a threat — record each under IND-01, IND-02
          or IND-04.
        </p>
      )}
      {showTeam && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {ind.rows.map((r) => (
            <li
              key={r.employeeId}
              className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
            >
              <span className="text-sm text-ink">
                {r.employeeName}
                <span className="ml-1 text-xs text-ink-faint">{r.role}</span>
                {r.disclosure && (
                  <span className="block text-xs text-ink-muted">{r.disclosure}</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {r.declaredAt && (
                  <span className="text-[11px] text-ink-faint">
                    {new Date(r.declaredAt).toLocaleDateString()}
                  </span>
                )}
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </span>
            </li>
          ))}
          {ind.rows.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-muted">
              No Engagement Partner, Manager or team is assigned to the engagement yet.
            </li>
          )}
        </ul>
      )}
      {ind.mine && <MyDeclaration acc={acc} mine={ind.mine} />}
    </div>
  );
}

function MyDeclaration({
  acc,
  mine,
}: {
  acc: StatutoryAuditAcceptance;
  mine: IndependenceDeclarationRow;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(mine.status === 'pending');
  const [disclosing, setDisclosing] = useState(false);
  const [disclosure, setDisclosure] = useState(mine.disclosure ?? '');
  const save = useMutation({
    mutationFn: (body: RecordIndependenceDeclarationInput) =>
      apiFetch(
        `/engagements/${acc.engagementId}/statutory-audit/${acc.workflowInstanceId}/acceptance/independence/declaration`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      setEditing(false);
      setDisclosing(false);
      void qc.invalidateQueries({
        queryKey: ['engagement', acc.engagementId, 'statutory-audit-acceptance'],
      });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not record the declaration.'),
  });

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <ShieldCheck className="h-4 w-4 text-success-600" aria-hidden />
          Your declaration: {STATUS_LABEL[mine.status]}
          {mine.declaredAt ? ` · ${new Date(mine.declaredAt).toLocaleDateString()}` : ''}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-xs font-semibold text-ink">Your independence declaration</p>
      <p className="text-xs text-ink-muted">
        I confirm I have no financial interest, relationship or other matter that threatens my
        independence from this client — or I disclose it below.
      </p>
      {disclosing && (
        <Textarea
          rows={3}
          aria-label="Disclosure"
          placeholder="Describe the interest, relationship or threat"
          value={disclosure}
          onChange={(e) => setDisclosure(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {!disclosing ? (
          <>
            <Button
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate({ status: 'independent' })}
            >
              I am independent
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDisclosing(true)}>
              Disclose a threat
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={save.isPending || !disclosure.trim()}
              onClick={() => save.mutate({ status: 'threat_disclosed', disclosure })}
            >
              Submit disclosure
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDisclosing(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
