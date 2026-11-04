'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  KYC_RISK_LABEL,
  KYC_RISK_RATINGS,
  KYC_STATUS_LABEL,
  kycCompleteProblems,
  kycNextReviewOn,
  type BeneficialOwner,
  type ClientKyc,
  type KycRiskRating,
  type KycStatus,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import {
  KYC_REGISTER_KEY,
  clientKycKey,
  completeClientKyc,
  fetchClientKyc,
  saveClientKyc,
} from '@/lib/client-kyc-api';
import { todayIst } from '@/components/work/my-task-columns';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';

export const KYC_TONE: Record<KycStatus, string> = {
  pending: 'warn',
  complete: 'success',
  expired: 'danger',
};

interface Draft {
  panVerified: boolean;
  riskRating: KycRiskRating | '';
  checklist: Record<string, boolean>;
  owners: BeneficialOwner[];
  notes: string;
}

const draftOf = (k: ClientKyc): Draft => ({
  panVerified: k.panVerified,
  riskRating: k.riskRating ?? '',
  checklist: Object.fromEntries(k.checklist.map((i) => [i.code, i.done])),
  owners: k.beneficialOwners,
  notes: k.notes ?? '',
});

/**
 * PS-404 · Client 360's KYC card: the checklist in force, the PAN check, who
 * owns the client, the risk rating and the review date. Anyone who sees the
 * client collects; a manager or partner marks it complete. Changing a
 * complete KYC reopens it for review.
 */
export function KycCard({ entityId }: { entityId: string }): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const kyc = useQuery({
    queryKey: clientKycKey(entityId),
    queryFn: () => fetchClientKyc(entityId),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reviewedOn, setReviewedOn] = useState(todayIst());
  useEffect(() => {
    if (kyc.data) setDraft(draftOf(kyc.data));
  }, [kyc.data]);

  const refresh = (k: ClientKyc) => {
    qc.setQueryData(clientKycKey(entityId), k);
    void qc.invalidateQueries({ queryKey: KYC_REGISTER_KEY });
  };
  const fail = (fallback: string) => (err: unknown) =>
    toast(err instanceof ApiError ? err.message : fallback, 'error');

  const save = useMutation({
    mutationFn: () =>
      saveClientKyc(entityId, {
        version: kyc.data!.version,
        panVerified: draft!.panVerified,
        riskRating: draft!.riskRating || null,
        checklist: draft!.checklist,
        beneficialOwners: draft!.owners
          .filter((o) => o.name.trim())
          .map((o) => ({
            name: o.name.trim(),
            pan: o.pan?.trim() || null,
            holdingPercent: o.holdingPercent?.trim() || null,
            role: o.role?.trim() || null,
          })),
        notes: draft!.notes.trim() || null,
      }),
    onSuccess: (k) => {
      refresh(k);
      toast('KYC saved.', 'success');
    },
    onError: fail('Could not save the KYC.'),
  });
  const complete = useMutation({
    mutationFn: () => completeClientKyc(entityId, { version: kyc.data!.version, reviewedOn }),
    onSuccess: (k) => {
      refresh(k);
      toast('KYC marked complete.', 'success');
    },
    onError: fail('Could not mark the KYC complete.'),
  });

  const k = kyc.data;
  const dirty = !!k && !!draft && JSON.stringify(draftOf(k)) !== JSON.stringify(draft);
  const problems =
    k && draft
      ? kycCompleteProblems({
          panVerified: draft.panVerified,
          riskRating: draft.riskRating || null,
          checklist: k.checklist.map((i) => ({ ...i, done: draft.checklist[i.code] === true })),
        })
      : [];
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setOwner = (i: number, patch: Partial<BeneficialOwner>) =>
    set({ owners: draft!.owners.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>KYC</CardTitle>
        {k && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Badge tone={KYC_TONE[k.status]}>{KYC_STATUS_LABEL[k.status]}</Badge>
            {k.reviewedOn && (
              <span>
                Reviewed {formatDate(k.reviewedOn)}
                {k.reviewedBy ? ` by ${k.reviewedBy.name}` : ''}
              </span>
            )}
            {k.nextReviewOn && <span>· next review {formatDate(k.nextReviewOn)}</span>}
          </div>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        {kyc.isLoading && <Spinner label="Loading the KYC…" />}
        {kyc.isError && (
          <p className="text-sm text-danger-700">
            {kyc.error instanceof ApiError ? kyc.error.message : 'Could not load the KYC.'}
          </p>
        )}
        {k && draft && (
          <>
            {!k.onFile && (
              <p className="text-sm text-ink-muted">
                Nothing on file yet. Tick what you have collected and save.
              </p>
            )}
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-ink">Checklist</legend>
              <ul className="grid gap-1 sm:grid-cols-2">
                {k.checklist.map((i) => (
                  <li key={i.code}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={draft.checklist[i.code] === true}
                        onChange={(ev) =>
                          set({ checklist: { ...draft.checklist, [i.code]: ev.target.checked } })
                        }
                      />
                      <span>
                        {i.label}
                        {i.mandatory && <span className="ml-0.5 text-danger-600">*</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.panVerified}
                  onChange={(ev) => set({ panVerified: ev.target.checked })}
                />
                PAN verified on the income-tax portal
                {k.panVerifiedOn && draft.panVerified && (
                  <span className="text-xs text-ink-faint">({formatDate(k.panVerifiedOn)})</span>
                )}
              </label>
              <Field
                label="Risk rating"
                hint={
                  draft.riskRating
                    ? `Reviewed again every ${
                        draft.riskRating === 'high'
                          ? k.settings.reviewYearsHigh
                          : k.settings.reviewYearsOther
                      } year(s).`
                    : undefined
                }
              >
                <Select
                  value={draft.riskRating}
                  onChange={(ev) => set({ riskRating: ev.target.value as KycRiskRating | '' })}
                >
                  <option value="">Not rated</option>
                  {KYC_RISK_RATINGS.map((r) => (
                    <option key={r} value={r}>
                      {KYC_RISK_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-ink">Beneficial owners</legend>
              {draft.owners.length === 0 && (
                <p className="text-xs text-ink-faint">None recorded.</p>
              )}
              <div className="space-y-2">
                {draft.owners.map((o, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
                  >
                    <Input
                      aria-label={`Owner ${i + 1} name`}
                      placeholder="Name"
                      value={o.name}
                      onChange={(ev) => setOwner(i, { name: ev.target.value })}
                    />
                    <Input
                      aria-label={`Owner ${i + 1} PAN`}
                      placeholder="PAN"
                      value={o.pan ?? ''}
                      onChange={(ev) => setOwner(i, { pan: ev.target.value.toUpperCase() })}
                    />
                    <Input
                      aria-label={`Owner ${i + 1} holding %`}
                      placeholder="Holding %"
                      inputMode="decimal"
                      value={o.holdingPercent ?? ''}
                      onChange={(ev) => setOwner(i, { holdingPercent: ev.target.value })}
                    />
                    <Input
                      aria-label={`Owner ${i + 1} role`}
                      placeholder="Role"
                      value={o.role ?? ''}
                      onChange={(ev) => setOwner(i, { role: ev.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove owner ${i + 1}`}
                      onClick={() => set({ owners: draft.owners.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="subtle"
                size="sm"
                className="mt-2"
                onClick={() =>
                  set({
                    owners: [
                      ...draft.owners,
                      { name: '', pan: null, holdingPercent: null, role: null },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden /> Add owner
              </Button>
            </fieldset>

            <Field label="Notes">
              <Textarea
                value={draft.notes}
                maxLength={4000}
                onChange={(ev) => set({ notes: ev.target.value })}
              />
            </Field>

            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? 'Saving…'
                  : k.status === 'complete'
                    ? 'Save (reopens it)'
                    : 'Save'}
              </Button>
              {k.can.complete && k.status !== 'complete' && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Reviewed on">
                    <Input
                      type="date"
                      max={todayIst()}
                      value={reviewedOn}
                      onChange={(ev) => setReviewedOn(ev.target.value)}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={dirty || problems.length > 0 || !reviewedOn || complete.isPending}
                    title={dirty ? 'Save your changes first.' : problems.join(' ')}
                    onClick={() => complete.mutate()}
                  >
                    Mark complete
                  </Button>
                </div>
              )}
            </div>
            {k.can.complete && k.status !== 'complete' && problems.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-ink-muted">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {k.can.complete &&
              k.status !== 'complete' &&
              !problems.length &&
              draft.riskRating &&
              reviewedOn && (
                <p className="text-xs text-ink-muted">
                  Next review on{' '}
                  {formatDate(kycNextReviewOn(reviewedOn, draft.riskRating, k.settings))}.
                </p>
              )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
