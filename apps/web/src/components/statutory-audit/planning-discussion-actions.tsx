'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ListChecks, Plus, Sparkles } from 'lucide-react';
import {
  PLANNING_ATTENTION_LABEL,
  PLANNING_ATTENTIONS,
  PLANNING_MATTER_CATEGORIES,
  type DiscussionSignalCreated,
  type PlanningAttention,
  type PlanningMatterCategory,
  type PlanningMatterRecord,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { MATTER_CATEGORY_LABEL } from './planning-strategy-sections';
import { usePlanningGov } from './planning-governance';

/**
 * 03.1.8 — what the team discussion produces, captured where it happens: a
 * new Planning Signal ("Create Planning Signal") and actions with an owner and
 * due date (Planning Matters, origin "discussion"), so nothing agreed in the
 * room is lost in narrative.
 */
export function DiscussionActions({
  qk,
  team,
  onChanged,
}: {
  qk: string[];
  team: TeamMember[];
  onChanged: () => void;
}): JSX.Element {
  const gov = usePlanningGov();
  const [mode, setMode] = useState<'signal' | 'action' | null>(null);
  const matters = useQuery({
    queryKey: [...qk, 'matters'],
    queryFn: () => apiFetch<PlanningMatterRecord[]>(`${gov.base}/planning-matters`),
  });
  const actions = (matters.data ?? []).filter((m) => m.origin === 'discussion');
  const may = gov.can('discussion');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <ListChecks className="h-4 w-4 text-ink-faint" />
        Discussion actions
      </div>
      {actions.length === 0 ? (
        <p className="text-xs text-ink-muted">No actions recorded from the discussion.</p>
      ) : (
        <ul className="space-y-1">
          {actions.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 text-ink">
                <span className="mr-1.5 font-mono text-ink-faint">{m.matterCode}</span>
                {m.title}
                <span className="text-ink-faint">
                  {' '}
                  · {m.ownerName ?? 'no owner'}
                  {m.dueDate ? ` · due ${m.dueDate}` : ''}
                </span>
              </span>
              <Badge tone={m.status === 'resolved' ? 'success' : 'info'}>
                {m.status.replace(/_/g, ' ')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {may && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={mode === 'action' ? 'primary' : 'secondary'}
            onClick={() => setMode(mode === 'action' ? null : 'action')}
            aria-expanded={mode === 'action'}
          >
            <Plus className="h-4 w-4" /> Add action
          </Button>
          <Button
            size="sm"
            variant={mode === 'signal' ? 'primary' : 'secondary'}
            onClick={() => setMode(mode === 'signal' ? null : 'signal')}
            aria-expanded={mode === 'signal'}
          >
            <Sparkles className="h-4 w-4" /> Create Planning Signal
          </Button>
        </div>
      )}
      {may && mode === 'action' && (
        <ActionForm
          team={team}
          onDone={() => {
            setMode(null);
            void matters.refetch();
            onChanged();
          }}
          onCancel={() => setMode(null)}
        />
      )}
      {may && mode === 'signal' && (
        <SignalForm
          onDone={() => {
            setMode(null);
            onChanged();
          }}
          onCancel={() => setMode(null)}
        />
      )}
    </div>
  );
}

function ActionForm({
  team,
  onDone,
  onCancel,
}: {
  team: TeamMember[];
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element {
  const gov = usePlanningGov();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [category, setCategory] = useState<PlanningMatterCategory>('other');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<PlanningMatterRecord>(`${gov.base}/planning-discussion/actions`, {
        method: 'POST',
        body: { title, ownerEmployeeId: owner, dueDate: due || undefined, category },
      }),
    onSuccess: (m) => {
      toast(`${m.matterCode} recorded for ${m.ownerName ?? 'the owner'}.`);
      onDone();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not record the action.', 'error'),
  });
  return (
    <Card className="space-y-2 p-3">
      <Field label="Action" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Owner" required>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">— Select —</option>
            {team.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>
                {m.employeeName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due date">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as PlanningMatterCategory)}
          >
            {PLANNING_MATTER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MATTER_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending || !title.trim() || !owner}
        >
          Record action
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function SignalForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}): JSX.Element {
  const gov = usePlanningGov();
  const toast = useToast();
  const [observation, setObservation] = useState('');
  const [why, setWhy] = useState('');
  const [attention, setAttention] = useState<PlanningAttention>('standard');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<DiscussionSignalCreated>(`${gov.base}/planning-discussion/signals`, {
        method: 'POST',
        body: { observation, whyMayMatter: why || undefined, suggestedAttention: attention },
      }),
    onSuccess: (s) => {
      toast(`${s.signalCode} raised from the discussion and listed as discussed.`);
      onDone();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not raise the signal.', 'error'),
  });
  return (
    <Card className="space-y-2 p-3">
      <Field label="Observation" hint="State the fact only — not a risk conclusion." required>
        <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Why this may matter">
          <Input value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        <Field label="Attention level">
          <Select
            value={attention}
            onChange={(e) => setAttention(e.target.value as PlanningAttention)}
          >
            {PLANNING_ATTENTIONS.map((a) => (
              <option key={a} value={a}>
                {PLANNING_ATTENTION_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending || !observation.trim()}
        >
          Create Planning Signal
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
