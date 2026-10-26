'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Pencil, Plus, Star, UserMinus, X } from 'lucide-react';
import {
  CLIENT_TEAM_NAME_MAX,
  CLIENT_TEAM_ROLE,
  CLIENT_TEAM_ROLE_LABEL,
  PERMISSION,
  type AddTeamMembersInput,
  type AssignTeamClientsResult,
  type TeamDetail,
  type TeamMember,
  type TeamPerson,
  type UpdateTeamInput,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useTeamPeople } from '@/lib/teams';
import { useToast } from '@/lib/toast';
import { Field, Input, Textarea } from '@/components/form';
import { Modal } from '@/components/modal';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { PartnerSelect, PeopleMultiPicker } from '@/components/teams/person-picker';
import { ClientMultiPicker, type PickedClient } from '@/components/teams/client-multi-picker';

/** CM-8 · a client team: its people, its clients, and archive. */
export default function TeamPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.teamManage);
  const qc = useQueryClient();
  const toast = useToast();
  const team = useQuery({
    queryKey: ['teams', 'detail', id],
    queryFn: () => apiFetch<TeamDetail>(`/teams/${id}`),
    enabled: can(principal, PERMISSION.teamRead),
  });
  const people = useTeamPeople(canManage);

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingClients, setAddingClients] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const done = (data: TeamDetail): void => {
    qc.setQueryData(['teams', 'detail', id], data);
    qc.invalidateQueries({ queryKey: ['teams', 'list'] });
  };
  const fail = (fallback: string) => (err: unknown) =>
    toast(err instanceof ApiError ? err.message : fallback, 'error');

  const addMembers = useMutation({
    mutationFn: (body: AddTeamMembersInput) =>
      apiFetch<TeamDetail>(`/teams/${id}/members`, { method: 'POST', body }),
    onSuccess: (data) => {
      done(data);
      toast('Team updated.', 'success');
    },
    onError: fail('Could not update the team.'),
  });
  const removeClient = useMutation({
    mutationFn: (entityId: string) =>
      apiFetch(`/entities/${entityId}/team`, { method: 'PUT', body: { teamId: null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['entities'] });
      toast('Client removed from the team.', 'success');
    },
    onError: fail('Could not remove the client.'),
  });
  const archive = useMutation({
    mutationFn: () => apiFetch<TeamDetail>(`/teams/${id}/archive`, { method: 'POST' }),
    onSuccess: (data) => {
      done(data);
      toast(`${data.name} archived.`, 'success');
    },
    onError: fail('Could not archive the team.'),
  });

  if (team.isLoading) return <Spinner label="Loading team…" />;
  if (team.isError || !team.data) {
    return (
      <div>
        <PageHeader title="Client team" back={{ href: '/people/teams', label: 'Client teams' }} />
        <EmptyState>
          {team.error instanceof ApiError ? team.error.message : 'Could not load the team.'}
        </EmptyState>
      </div>
    );
  }
  const t = team.data;
  const live = !t.archivedAt && canManage;
  const memberIds = new Set(t.members.map((m) => m.id));
  const sorted = [...t.members].sort((a, b) =>
    a.teamRole === b.teamRole
      ? a.fullName.localeCompare(b.fullName)
      : a.teamRole === CLIENT_TEAM_ROLE.overseeingPartner
        ? -1
        : 1,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.name}
        subtitle={[
          t.officeCode ? `Office ${t.officeCode}` : 'Any office',
          t.description ?? undefined,
          t.archivedAt ? 'Archived' : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
        back={{ href: '/people/teams', label: 'Client teams' }}
        actions={
          live ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={archive.isPending}
                onClick={() => {
                  if (t.clientCount > 0) {
                    toast(
                      `${t.name} still serves ${t.clientCount} client${t.clientCount === 1 ? '' : 's'}. Move them to another team first.`,
                      'error',
                    );
                    return;
                  }
                  if (window.confirm(`Archive ${t.name}?`)) archive.mutate();
                }}
              >
                <Archive className="h-4 w-4" /> Archive team
              </Button>
            </div>
          ) : undefined
        }
      />

      {t.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t.warnings.map((w) => (
            <p key={w} className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>People ({t.members.length})</CardTitle>
            {live && (
              <Button size="sm" variant="subtle" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add people
              </Button>
            )}
          </CardHeader>
          <CardBody>
            {sorted.length === 0 ? (
              <EmptyState>No one on this team yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {sorted.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-ink">
                        {m.fullName}
                        {!m.active && (
                          <Badge tone="warn" className="ml-2">
                            Left the firm
                          </Badge>
                        )}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {m.gradeName} · {m.officeCode}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        tone={
                          m.teamRole === CLIENT_TEAM_ROLE.overseeingPartner ? 'info' : 'neutral'
                        }
                      >
                        {CLIENT_TEAM_ROLE_LABEL[m.teamRole]}
                      </Badge>
                      {live &&
                        m.teamRole === CLIENT_TEAM_ROLE.associate &&
                        m.isPartner &&
                        m.active && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Make overseeing partner"
                            disabled={addMembers.isPending}
                            onClick={() =>
                              addMembers.mutate({
                                employeeIds: [m.id],
                                teamRole: CLIENT_TEAM_ROLE.overseeingPartner,
                              })
                            }
                          >
                            <Star className="h-4 w-4" />
                            <span className="sr-only">Make overseeing partner</span>
                          </Button>
                        )}
                      {live && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Remove"
                          onClick={() => setRemoving(m)}
                        >
                          <UserMinus className="h-4 w-4" />
                          <span className="sr-only">Remove {m.fullName}</span>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Clients ({t.clients.length})</CardTitle>
            {live && (
              <Button size="sm" variant="subtle" onClick={() => setAddingClients(true)}>
                <Plus className="h-4 w-4" /> Add clients
              </Button>
            )}
          </CardHeader>
          <CardBody>
            {t.clients.length === 0 ? (
              <EmptyState>No clients yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {t.clients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/entities/${c.id}`} className="min-w-0 hover:text-primary-600">
                      <span className="block truncate text-sm font-medium">{c.legalName}</span>
                      <span className="block text-xs text-ink-faint">{c.entityCode}</span>
                    </Link>
                    {live && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove from team"
                        disabled={removeClient.isPending}
                        onClick={() => removeClient.mutate(c.id)}
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Remove {c.legalName}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {editing && <EditTeamModal team={t} onClose={() => setEditing(false)} onSaved={done} />}
      {adding && (
        <AddPeopleModal
          people={people.data ?? []}
          exclude={memberIds}
          hasPartner={!!t.overseeingPartner}
          pending={addMembers.isPending}
          onClose={() => setAdding(false)}
          onAdd={(body) => addMembers.mutate(body, { onSuccess: () => setAdding(false) })}
        />
      )}
      {addingClients && <AddClientsModal teamId={t.id} onClose={() => setAddingClients(false)} />}
      {removing && (
        <RemoveMemberModal
          teamId={t.id}
          member={removing}
          people={people.data ?? []}
          onClose={() => setRemoving(null)}
          onRemoved={done}
        />
      )}
    </div>
  );
}

function EditTeamModal({
  team,
  onClose,
  onSaved,
}: {
  team: TeamDetail;
  onClose: () => void;
  onSaved: (t: TeamDetail) => void;
}): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body: UpdateTeamInput = {
        name: name.trim(),
        description: description.trim() || null,
        version: team.version,
      };
      return apiFetch<TeamDetail>(`/teams/${team.id}`, { method: 'PATCH', body });
    },
    onSuccess: (t) => {
      onSaved(t);
      toast('Team saved.', 'success');
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not save the team.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit team"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Team name" required>
          <Input
            value={name}
            maxLength={CLIENT_TEAM_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
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

function AddPeopleModal({
  people,
  exclude,
  hasPartner,
  pending,
  onClose,
  onAdd,
}: {
  people: TeamPerson[];
  exclude: Set<string>;
  hasPartner: boolean;
  pending: boolean;
  onClose: () => void;
  onAdd: (body: AddTeamMembersInput) => void;
}): JSX.Element {
  const [role, setRole] = useState<AddTeamMembersInput['teamRole']>(
    hasPartner ? CLIENT_TEAM_ROLE.associate : CLIENT_TEAM_ROLE.overseeingPartner,
  );
  const [ids, setIds] = useState<string[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const isPartner = role === CLIENT_TEAM_ROLE.overseeingPartner;
  const ready = isPartner ? !!partnerId : ids.length > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Add people"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || pending}
            onClick={() => onAdd({ employeeIds: isPartner ? [partnerId] : ids, teamRole: role })}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-4 text-sm">
          {[CLIENT_TEAM_ROLE.associate, CLIENT_TEAM_ROLE.overseeingPartner].map((r) => (
            <label key={r} className="inline-flex items-center gap-2">
              <input type="radio" checked={role === r} onChange={() => setRole(r)} />
              {CLIENT_TEAM_ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        {isPartner ? (
          <Field
            label="Overseeing partner"
            hint={
              hasPartner
                ? 'Replaces the current overseeing partner, who stays on as an associate.'
                : undefined
            }
          >
            <PartnerSelect people={people} value={partnerId} onChange={setPartnerId} />
          </Field>
        ) : (
          <PeopleMultiPicker people={people} value={ids} onChange={setIds} exclude={exclude} />
        )}
      </div>
    </Modal>
  );
}

function AddClientsModal({
  teamId,
  onClose,
}: {
  teamId: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [clients, setClients] = useState<PickedClient[]>([]);
  const assign = useMutation({
    mutationFn: () =>
      apiFetch<AssignTeamClientsResult>(`/teams/${teamId}/clients`, {
        method: 'POST',
        body: { entityIds: clients.map((c) => c.id) },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['entities'] });
      const moved = r.assigned.filter((a) => a.fromTeam).length;
      toast(
        `${r.assigned.length} client${r.assigned.length === 1 ? '' : 's'} added${moved ? `, ${moved} moved from another team` : ''}.`,
        'success',
      );
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not add the clients.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add clients"
      description="A client has one team. Picking a client on another team moves it here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clients.length || assign.isPending} onClick={() => assign.mutate()}>
            Add {clients.length || ''} client{clients.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <ClientMultiPicker value={clients} onChange={setClients} teamId={teamId} />
    </Modal>
  );
}

function RemoveMemberModal({
  teamId,
  member,
  people,
  onClose,
  onRemoved,
}: {
  teamId: string;
  member: TeamMember;
  people: TeamPerson[];
  onClose: () => void;
  onRemoved: (t: TeamDetail) => void;
}): JSX.Element {
  const toast = useToast();
  const overseer = member.teamRole === CLIENT_TEAM_ROLE.overseeingPartner;
  const [replacementId, setReplacementId] = useState('');
  const remove = useMutation({
    mutationFn: () =>
      apiFetch<TeamDetail>(
        `/teams/${teamId}/members/${member.id}${overseer ? `?replacementId=${replacementId}` : ''}`,
        { method: 'DELETE' },
      ),
    onSuccess: (t) => {
      onRemoved(t);
      toast(`${member.fullName} removed.`, 'success');
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not remove them.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Remove ${member.fullName}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(overseer && !replacementId) || remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        </>
      }
    >
      {overseer ? (
        <Field
          label="New overseeing partner"
          hint={`${member.fullName} oversees this team. Name who takes over.`}
        >
          <PartnerSelect
            people={people}
            value={replacementId}
            onChange={setReplacementId}
            exclude={new Set([member.id])}
          />
        </Field>
      ) : (
        <p className="text-sm text-ink-muted">
          They stay on any engagement they are already staffed on.
        </p>
      )}
    </Modal>
  );
}
