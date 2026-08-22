'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { ENTITY_STATUSES, PAN_REGEX } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { DuplicateCandidate, EntityType, OfficeRow } from '@/lib/types';
import { PageHeader, Card, CardBody, Button, Spinner, Badge } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

interface CreatedEntity {
  id: string;
}

export default function NewEntityPage(): JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [typeSlug, setTypeSlug] = useState('');
  const [officeCode, setOfficeCode] = useState('');
  const [pan, setPan] = useState('');
  const [status, setStatus] = useState<string>('active');
  const [incorporationDate, setIncorporationDate] = useState('');

  const types = useQuery({
    queryKey: ['entity-types'],
    queryFn: () => apiFetch<EntityType[]>('/entity-types'),
  });
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });

  // Default the selects once reference data arrives.
  useEffect(() => {
    if (!typeSlug && types.data?.[0]) setTypeSlug(types.data[0].slug);
  }, [types.data, typeSlug]);
  useEffect(() => {
    if (!officeCode && offices.data?.[0]) setOfficeCode(offices.data[0].code);
  }, [offices.data, officeCode]);

  const panValid = pan === '' || PAN_REGEX.test(pan.trim().toUpperCase());

  // Live duplicate-check, debounced, on legal name and/or a valid PAN.
  const [debounced, setDebounced] = useState({ legalName: '', pan: '' });
  useEffect(() => {
    const t = setTimeout(
      () => setDebounced({ legalName: legalName.trim(), pan: pan.trim().toUpperCase() }),
      350,
    );
    return () => clearTimeout(t);
  }, [legalName, pan]);

  const dupePan = PAN_REGEX.test(debounced.pan) ? debounced.pan : '';
  const dupeName = debounced.legalName.length >= 3 ? debounced.legalName : '';
  const dupes = useQuery({
    queryKey: ['entities', 'dupe', dupeName, dupePan],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dupeName) params.set('legalName', dupeName);
      if (dupePan) params.set('pan', dupePan);
      return apiFetch<DuplicateCandidate[]>(`/entities/duplicate-check?${params.toString()}`);
    },
    enabled: dupeName.length > 0 || dupePan.length > 0,
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<CreatedEntity>('/entities', {
        method: 'POST',
        body: {
          legalName: legalName.trim(),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          typeSlug,
          officeCode,
          ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}),
          status,
          ...(incorporationDate ? { incorporationDate } : {}),
        },
      }),
    onSuccess: (data) => {
      toast('Client entity created.');
      qc.invalidateQueries({ queryKey: ['entities'] });
      router.push(`/entities/${data.id}`);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not create the entity.', 'error'),
  });

  const canSubmit = useMemo(
    () => legalName.trim().length > 0 && !!typeSlug && !!officeCode && panValid,
    [legalName, typeSlug, officeCode, panValid],
  );

  if (types.isLoading || offices.isLoading) return <Spinner label="Loading…" />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New client entity" subtitle="Onboard a client. We check for duplicates as you type." />
      <Card>
        <CardBody className="space-y-4">
          <Field label="Legal name" required>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Acme Manufacturing Pvt Ltd" />
          </Field>

          {(dupes.data?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning-700">
                <AlertTriangle className="h-4 w-4" /> Possible duplicate{dupes.data!.length > 1 ? 's' : ''}
              </div>
              <ul className="space-y-1">
                {dupes.data!.map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    <Link href={`/entities/${d.id}`} className="text-primary-700 hover:underline">
                      {d.legalName} <span className="text-ink-faint">({d.entityCode})</span>
                    </Link>
                    <Badge tone={d.matchReason === 'pan' ? 'danger' : 'warn'}>
                      {d.matchReason === 'pan' ? 'Same PAN' : 'Similar name'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Display name" hint="Short name (optional).">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme" />
            </Field>
            <Field label="Entity type" required>
              <Select value={typeSlug} onChange={(e) => setTypeSlug(e.target.value)}>
                {(types.data ?? []).map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Home office" required>
              <Select value={officeCode} onChange={(e) => setOfficeCode(e.target.value)}>
                {(offices.data ?? []).map((o) => (
                  <option key={o.id} value={o.code}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {ENTITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="PAN" hint={pan && !panValid ? 'Invalid PAN (e.g. AAACA1234A).' : 'Optional; unique when set.'}>
              <Input
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="AAACA1234A"
                className={pan && !panValid ? 'border-danger-400' : undefined}
              />
            </Field>
            <Field label="Incorporation date">
              <Input type="date" value={incorporationDate} onChange={(e) => setIncorporationDate(e.target.value)} />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create entity'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
