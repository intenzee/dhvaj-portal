'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLIENT_TEAM_NAME_MAX, type CreateTeamInput, type TeamDetail } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { teamCountLine, useTeamPeople } from '@/lib/teams';
import { useToast } from '@/lib/toast';
import type { OfficeRow } from '@/lib/types';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Button } from '@/components/ui';
import { PartnerSelect, PeopleMultiPicker } from './person-picker';
import { ClientMultiPicker, type PickedClient } from './client-multi-picker';

/** CM-8 · the New team window: everything in one step, then the team page opens. */
export function NewTeamModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const people = useTeamPeople(open);
  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
    enabled: open,
  });
  const [name, setName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [associates, setAssociates] = useState<string[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [description, setDescription] = useState('');
  const [clients, setClients] = useState<PickedClient[]>([]);
  const [tried, setTried] = useState(false);

  const reset = (): void => {
    setName('');
    setPartnerId('');
    setAssociates([]);
    setOfficeId('');
    setDescription('');
    setClients([]);
    setTried(false);
  };

  const create = useMutation({
    mutationFn: () => {
      const body: CreateTeamInput = {
        name: name.trim(),
        overseeingPartnerId: partnerId,
        associateIds: associates,
        officeId: officeId || null,
        description: description.trim() || null,
        entityIds: clients.map((c) => c.id),
      };
      return apiFetch<TeamDetail>('/teams', { method: 'POST', body });
    },
    onSuccess: (team) => {
      toast(`${team.name} created.`, 'success');
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['entities'] });
      qc.invalidateQueries({ queryKey: ['entity'] });
      reset();
      onClose();
      router.push(`/people/teams/${team.id}`);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not create the team.', 'error'),
  });

  const nameError = !name.trim() ? 'Give the team a name.' : null;
  const partnerError = !partnerId ? 'Pick the overseeing partner.' : null;
  const submit = (): void => {
    setTried(true);
    if (nameError || partnerError) return;
    create.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New client team"
      description="One overseeing partner and any number of associates. Each new engagement for the team's clients starts with them."
      wide
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">
            {teamCountLine(!!partnerId, associates.length, clients.length)}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create team'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="Team name"
          required
          hint={tried && nameError ? nameError : 'For example "GST — North".'}
        >
          <Input
            value={name}
            maxLength={CLIENT_TEAM_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={tried && !!nameError}
            autoFocus
          />
        </Field>
        <Field
          label="Overseeing partner"
          required
          hint={tried && partnerError ? partnerError : 'Partners and the Managing Partner only.'}
        >
          <PartnerSelect
            people={people.data ?? []}
            value={partnerId}
            onChange={(id) => {
              setPartnerId(id);
              setAssociates((a) => a.filter((x) => x !== id));
            }}
          />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Associates</span>
          <PeopleMultiPicker
            people={people.data ?? []}
            value={associates}
            onChange={setAssociates}
            exclude={new Set(partnerId ? [partnerId] : [])}
          />
        </div>
        <Field label="Office" hint="Optional, for filtering.">
          <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">Any office</option>
            {(offices.data ?? [])
              .filter((o) => o.isActive)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name}
                </option>
              ))}
          </Select>
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Clients</span>
          <ClientMultiPicker value={clients} onChange={setClients} />
        </div>
        <Field label="Description">
          <Textarea
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
