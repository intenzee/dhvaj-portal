'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  REGISTER_UDIN_PATTERN,
  UDIN_DOCUMENT_KINDS,
  UDIN_DOCUMENT_KIND_LABEL,
  udinMembershipNo,
  type CreateUdinInput,
  type Paginated,
  type UdinDocumentKind,
  type UdinEntry,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { createUdin, fetchUdinPartners } from '@/lib/registers-api';
import type { EngagementRow } from '@/lib/types';
import { todayIst } from '@/components/work/my-task-columns';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Button } from '@/components/ui';
import { InlinePanel } from '@/components/inline-panel';
import { EntityPicker, type Picked } from '@/components/entity-picker';

/** What a "signed without a UDIN" row carries into the form. */
export interface UdinPrefill {
  documentKind: UdinDocumentKind;
  entity: Picked;
  engagementId: string | null;
  signingPartnerId: string | null;
  signedOn: string;
  financialYear: string | null;
}

/** The checks the API makes, ahead of it, so the person sees them as they type. Pure — tested. */
export function udinFormProblem(
  v: { udin: string; signedOn: string; generatedOn: string },
  partnerMembershipNo: string | null,
  today: string,
): string | null {
  const udin = v.udin.trim().toUpperCase();
  if (!udin) return null;
  if (!REGISTER_UDIN_PATTERN.test(udin)) {
    return 'A UDIN is 18 characters: the 2-digit year, the 6-digit membership no. and 10 letters or digits.';
  }
  if (partnerMembershipNo && /^\d{6}$/.test(partnerMembershipNo)) {
    if (udinMembershipNo(udin) !== partnerMembershipNo) {
      return `This UDIN carries membership no. ${udinMembershipNo(udin)}, but the signing partner's is ${partnerMembershipNo}.`;
    }
  }
  if (v.signedOn && v.generatedOn && v.generatedOn < v.signedOn) {
    return 'A UDIN is generated on or after the day the report is signed.';
  }
  if (v.generatedOn > today) return "The UDIN's generation date can't be in the future.";
  return null;
}

/** PS-304 — add a UDIN, inline under the header (or under the report it is for). */
export function UdinForm({
  prefill,
  onClose,
  onSaved,
}: {
  prefill: UdinPrefill | null;
  onClose: () => void;
  onSaved: (e: UdinEntry) => void;
}): JSX.Element {
  const today = todayIst();
  const [entity, setEntity] = useState<Picked | null>(prefill?.entity ?? null);
  const [v, setV] = useState({
    udin: '',
    documentKind: prefill?.documentKind ?? ('audit_report' as UdinDocumentKind),
    engagementId: prefill?.engagementId ?? '',
    signingPartnerId: prefill?.signingPartnerId ?? '',
    signedOn: prefill?.signedOn ?? '',
    generatedOn: today,
    financialYear: prefill?.financialYear ?? '',
    description: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void =>
    setV((cur) => ({ ...cur, [k]: val }));

  const partners = useQuery({
    queryKey: ['registers', 'udin', 'partners'],
    queryFn: fetchUdinPartners,
  });
  const engagements = useQuery({
    queryKey: ['engagements', 'for-entity', entity?.id],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(`/engagements?entityId=${entity!.id}&limit=100`),
    enabled: !!entity,
    retry: false,
  });
  const partner = partners.data?.find((p) => p.employeeId === v.signingPartnerId) ?? null;
  const problem = udinFormProblem(v, partner?.membershipNo ?? null, today);

  const save = useMutation({
    mutationFn: () => {
      const body: CreateUdinInput = {
        udin: v.udin.trim().toUpperCase(),
        documentKind: v.documentKind,
        entityId: entity!.id,
        engagementId: v.engagementId || null,
        signingPartnerId: v.signingPartnerId,
        signedOn: v.signedOn,
        generatedOn: v.generatedOn,
        financialYear: v.financialYear || null,
        description: v.description.trim() || null,
      };
      return createUdin(body);
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });
  const ready =
    !!entity &&
    !!v.udin.trim() &&
    !!v.signingPartnerId &&
    !!v.signedOn &&
    !!v.generatedOn &&
    !problem;

  return (
    <InlinePanel
      open
      onClose={onClose}
      title="Add a UDIN"
      description="The UDIN as generated on the ICAI portal, with the report it is for."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Add to register'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="UDIN" required>
          <Input
            value={v.udin}
            onChange={(e) => set('udin', e.target.value.toUpperCase())}
            placeholder="26123456ABCDEF1234"
            maxLength={18}
            aria-label="UDIN"
            className="font-mono"
          />
        </Field>
        <Field label="Document" required>
          <Select
            value={v.documentKind}
            onChange={(e) => set('documentKind', e.target.value as UdinDocumentKind)}
            aria-label="Document"
          >
            {UDIN_DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {UDIN_DOCUMENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Client" required className="sm:col-span-2">
          <EntityPicker
            value={entity}
            onChange={(e) => {
              setEntity(e);
              set('engagementId', '');
            }}
            exclude={new Set()}
          />
        </Field>
        <Field label="Engagement" hint="Optional — the job the document came out of.">
          <Select
            value={v.engagementId}
            onChange={(e) => set('engagementId', e.target.value)}
            disabled={!entity || !engagements.data}
            aria-label="Engagement"
          >
            <option value="">No engagement</option>
            {engagements.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                {g.engagementCode} · {g.serviceName} · {g.financialYear}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Signing partner" required>
          <Select
            value={v.signingPartnerId}
            onChange={(e) => set('signingPartnerId', e.target.value)}
            aria-label="Signing partner"
          >
            <option value="">Choose…</option>
            {partners.data?.map((p) => (
              <option key={p.employeeId} value={p.employeeId}>
                {p.name}
                {p.membershipNo ? ` (M.No. ${p.membershipNo})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Signed on" required>
          <Input
            type="date"
            value={v.signedOn}
            max={today}
            onChange={(e) => set('signedOn', e.target.value)}
            aria-label="Signed on"
          />
        </Field>
        <Field label="UDIN generated on" required>
          <Input
            type="date"
            value={v.generatedOn}
            max={today}
            onChange={(e) => set('generatedOn', e.target.value)}
            aria-label="UDIN generated on"
          />
        </Field>
        <Field label="Financial year" hint="Like 2025-26.">
          <Input
            value={v.financialYear}
            onChange={(e) => set('financialYear', e.target.value)}
            placeholder="2025-26"
            maxLength={7}
            aria-label="Financial year"
          />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={500}
            placeholder="e.g. Net worth certificate for the bank"
            aria-label="Description"
          />
        </Field>
      </div>
      {(problem || error) && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {problem ?? error}
        </p>
      )}
    </InlinePanel>
  );
}
