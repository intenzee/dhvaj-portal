'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Clock, Home, MapPin, Plus, Timer, Trash2 } from 'lucide-react';
import {
  ATTENDANCE_STATUS_LABEL,
  INTERNAL_WORK_CATEGORIES,
  LEAVE_TYPE_LABEL,
  WORK_LOCATION_LABEL,
  formatWorked,
  parseHoursInput,
  type DayEntry,
  type MyDay,
  type OtherTimeCategory,
  type PickEngagement,
  type PickTask,
  type WorkLocation,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { istToday } from '@/lib/people';
import { useToast } from '@/lib/toast';
import {
  LOCATION_ORDER,
  STATUS_TONE,
  categoryLabel,
  dayLabel,
  entryTitle,
  loggableDays,
  minutesLabel,
} from '@/lib/attendance';
import { Field, Input, Select } from '@/components/form';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';

const LOCATION_ICON: Record<WorkLocation, typeof Home> = {
  office: Building2,
  home: Home,
  client_office: MapPin,
};

/** Office / Home / Client's office as three buttons. */
export function LocationPicker({
  value,
  onChange,
  size = 'md',
  label,
}: {
  value: WorkLocation | null;
  onChange: (l: WorkLocation) => void;
  size?: 'sm' | 'md';
  label: string;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {LOCATION_ORDER.map((l) => {
        const Icon = LOCATION_ICON[l];
        return (
          <Button
            key={l}
            type="button"
            size={size}
            variant={value === l ? 'primary' : 'secondary'}
            role="radio"
            aria-checked={value === l}
            onClick={() => onChange(l)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {WORK_LOCATION_LABEL[l]}
          </Button>
        );
      })}
    </div>
  );
}

/** Hours worked against the full day, the status, and hours by place. */
export function DaySummary({ day }: { day: MyDay }): JSX.Element {
  const pct = Math.min(100, Math.round((day.workedSeconds / day.presentSeconds) * 100));
  const toGo = Math.max(0, day.presentSeconds - day.workedSeconds);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">{dayLabel(day.day, true)}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">
            {formatWorked(day.workedSeconds)}
            <span className="ml-1 text-base font-normal text-ink-muted">
              of {formatWorked(day.presentSeconds)}
            </span>
          </p>
        </div>
        <div className="text-right">
          <Badge tone={STATUS_TONE[day.status]} className="text-sm">
            {ATTENDANCE_STATUS_LABEL[day.status]}
          </Badge>
          {day.status === 'open' && toGo > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              {formatWorked(toGo)} more marks you present
            </p>
          )}
        </div>
      </div>
      <div
        className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Hours of the full day"
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct >= 100 ? 'bg-success-600' : pct >= 50 ? 'bg-warning-500' : 'bg-primary-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-muted">
        {LOCATION_ORDER.filter((l) => day.byLocation[l]).map((l) => (
          <span key={l}>
            {WORK_LOCATION_LABEL[l]}: <b className="text-ink">{formatWorked(day.byLocation[l]!)}</b>
          </span>
        ))}
        {!!day.byLocation.unset && (
          <span>
            Place not said: <b className="text-ink">{formatWorked(day.byLocation.unset)}</b>
          </span>
        )}
        {day.holidayName && <span>Holiday: {day.holidayName}</span>}
        {day.leave && (
          <span>
            {LEAVE_TYPE_LABEL[day.leave.type]}
            {day.leave.half ? ' (half day)' : ''} — approved
          </span>
        )}
        {day.pendingLeave && (
          <span>{LEAVE_TYPE_LABEL[day.pendingLeave.type]} asked for — waiting for approval</span>
        )}
      </div>
    </Card>
  );
}

/** One row of the day: what, how long, where. */
function EntryRow({
  entry,
  busy,
  onChange,
  onRemove,
}: {
  entry: DayEntry;
  busy: boolean;
  onChange?: (patch: { minutes?: number; location?: WorkLocation }) => void;
  onRemove?: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(minutesLabel(Math.round(entry.seconds / 60)));
  const minutes = parseHoursInput(hours);
  const canPlace = !!onChange && (entry.editable || entry.locationOnly);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{entryTitle(entry, categoryLabel)}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          {entry.engagementCode && <span>{entry.engagementCode}</span>}
          {entry.source === 'task_clock' ? (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" aria-hidden /> Task clock
            </span>
          ) : entry.source === 'logged' ? (
            <span>Logged</span>
          ) : null}
          {entry.running && <Badge tone="info">Running</Badge>}
          {entry.billed && <Badge>Billed</Badge>}
          {entry.note && <span className="truncate">“{entry.note}”</span>}
        </p>
      </div>
      {canPlace ? (
        <Select
          aria-label="Where it was worked"
          className="w-40 py-1.5 text-xs"
          value={entry.location ?? ''}
          disabled={busy}
          onChange={(e) => onChange!({ location: e.target.value as WorkLocation })}
        >
          {!entry.location && <option value="">Where?</option>}
          {LOCATION_ORDER.map((l) => (
            <option key={l} value={l}>
              {WORK_LOCATION_LABEL[l]}
            </option>
          ))}
        </Select>
      ) : (
        <span className="w-40 text-xs text-ink-muted">
          {entry.location ? WORK_LOCATION_LABEL[entry.location] : '—'}
        </span>
      )}
      {editing ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (minutes) onChange!({ minutes });
            setEditing(false);
          }}
        >
          <Input
            aria-label="Hours"
            className="w-24 py-1.5 text-xs"
            value={hours}
            autoFocus
            onChange={(e) => setHours(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={!minutes || busy}>
            Save
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button
          type="button"
          className={cn(
            'w-20 text-right text-sm font-semibold tabular-nums text-ink',
            entry.editable && onChange && 'rounded hover:bg-surface-sunken hover:text-primary-700',
          )}
          disabled={!entry.editable || !onChange}
          title={entry.editable ? 'Change the hours' : undefined}
          onClick={() => setEditing(true)}
        >
          {formatWorked(entry.seconds)}
        </button>
      )}
      {onRemove && entry.editable ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Take this row out"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <span className="w-9" />
      )}
    </li>
  );
}

/** Someone's rows, read only (Team attendance). */
export function EntryList({ entries }: { entries: DayEntry[] }): JSX.Element {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-ink-muted">Nothing on this day.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => (
        <EntryRow key={e.id} entry={e} busy={false} />
      ))}
    </ul>
  );
}

/** The engagement picker: yours first, type to search the rest you can work on. */
function EngagementSearch({
  value,
  onPick,
}: {
  value: PickEngagement | null;
  onPick: (e: PickEngagement | null) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ['attendance', 'pick', 'engagements', debounced],
    queryFn: () =>
      apiFetch<PickEngagement[]>(
        `/attendance/pick/engagements${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
      ),
    enabled: open,
    staleTime: 60_000,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{value.clientName}</p>
          <p className="truncate text-xs text-ink-muted">
            {value.engagementCode} · {value.title}
          </p>
        </div>
        <Button size="sm" variant="ghost" type="button" onClick={() => onPick(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        placeholder="Type the client’s name or the engagement code"
        value={q}
        aria-label="Client or engagement"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line-strong bg-surface shadow-card">
          {list.isLoading && (
            <div className="p-3">
              <Spinner label="Finding engagements…" />
            </div>
          )}
          {list.data?.length === 0 && (
            <p className="p-3 text-sm text-ink-muted">
              {debounced
                ? 'No open engagement of yours matches.'
                : 'You are on no open engagement yet.'}
            </p>
          )}
          <ul role="listbox" aria-label="Engagements">
            {list.data?.map((e) => (
              <li key={e.engagementId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="block w-full px-3 py-2 text-left hover:bg-surface-sunken"
                  onClick={() => {
                    onPick(e);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <span className="block truncate text-sm font-medium text-ink">
                    {e.clientName}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {e.engagementCode} · {e.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Add work": client work (engagement → stream → task) or firm work, hours and where. */
function LogForm({
  day,
  location,
  onLogged,
}: {
  day: string;
  location: WorkLocation | null;
  onLogged: (d: MyDay) => void;
}): JSX.Element {
  const toast = useToast();
  const [kind, setKind] = useState<'client' | 'firm'>('client');
  const [eng, setEng] = useState<PickEngagement | null>(null);
  const [stream, setStream] = useState('');
  const [task, setTask] = useState('');
  const [category, setCategory] = useState<OtherTimeCategory>('internal_meeting');
  const [hours, setHours] = useState('');
  const [where, setWhere] = useState<WorkLocation | null>(location);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (location) setWhere(location);
  }, [location]);

  const tasks = useQuery({
    queryKey: ['attendance', 'pick', 'tasks', eng?.engagementId],
    queryFn: () => apiFetch<PickTask[]>(`/attendance/pick/tasks?engagementId=${eng!.engagementId}`),
    enabled: !!eng,
  });
  const shownTasks = useMemo(
    () =>
      (tasks.data ?? []).filter(
        (t) => !stream || !t.engagementServiceId || t.engagementServiceId === stream,
      ),
    [tasks.data, stream],
  );
  const minutes = parseHoursInput(hours);

  const log = useMutation({
    mutationFn: () =>
      kind === 'client'
        ? apiFetch<MyDay>(`/attendance/day/${day}/work`, {
            method: 'POST',
            body: {
              engagementId: eng!.engagementId,
              ...(stream ? { engagementServiceId: stream } : {}),
              ...(task ? { taskId: task } : {}),
              minutes,
              location: where,
              ...(note.trim() ? { note: note.trim() } : {}),
            },
          })
        : apiFetch<MyDay>(`/attendance/day/${day}/internal`, {
            method: 'POST',
            body: {
              category,
              minutes,
              location: where,
              ...(note.trim() ? { note: note.trim() } : {}),
            },
          }),
    onSuccess: (d) => {
      onLogged(d);
      setHours('');
      setNote('');
      setTask('');
      toast(`${minutesLabel(minutes!)} logged.`, 'success');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not log the work.', 'error'),
  });

  const ready =
    !!minutes && minutes <= 720 && !!where && (kind === 'firm' || !!eng) && !log.isPending;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Add work</h2>
        <div className="flex gap-1" role="tablist" aria-label="What kind of work">
          <Button
            size="sm"
            role="tab"
            aria-selected={kind === 'client'}
            variant={kind === 'client' ? 'primary' : 'secondary'}
            onClick={() => setKind('client')}
          >
            Client work
          </Button>
          <Button
            size="sm"
            role="tab"
            aria-selected={kind === 'firm'}
            variant={kind === 'firm' ? 'primary' : 'secondary'}
            onClick={() => setKind('firm')}
          >
            Firm work
          </Button>
        </div>
      </div>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) log.mutate();
        }}
      >
        {kind === 'client' ? (
          <>
            <Field label="Client and engagement" required className="md:col-span-2">
              <EngagementSearch
                value={eng}
                onPick={(e) => {
                  setEng(e);
                  setStream('');
                  setTask('');
                }}
              />
            </Field>
            {eng && eng.streams.length > 0 && (
              <Field label="Stream" hint="GST, Income tax, TDS… (optional)">
                <Select value={stream} onChange={(e) => setStream(e.target.value)}>
                  <option value="">—</option>
                  {eng.streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {eng && (
              <Field label="Task" hint="A filing’s task puts the hours on that return (optional).">
                <Select value={task} onChange={(e) => setTask(e.target.value)}>
                  <option value="">—</option>
                  {shownTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.mine ? ' (yours)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        ) : (
          <Field label="What" required>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as OtherTimeCategory)}
            >
              {INTERNAL_WORK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Hours"
          required
          hint={
            hours && !minutes
              ? 'Write it as 2, 1.5, 1:30 or 1h 30m.'
              : minutes
                ? minutesLabel(minutes)
                : '2, 1.5, 1:30 or 1h 30m'
          }
        >
          <Input
            inputMode="decimal"
            placeholder="2"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </Field>
        <Field label="Where you worked" required className="md:col-span-2">
          <LocationPicker value={where} onChange={setWhere} label="Where you worked" />
        </Field>
        <Field label="Note" className="md:col-span-2" hint="Optional — e.g. “GSTR-3B for October”.">
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" disabled={!ready}>
            <Plus className="h-4 w-4" /> {log.isPending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Your day: pick the day, see where it stands, add and fix rows. */
export function MyDayTab({ initialDay }: { initialDay?: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const today = istToday();
  const days = loggableDays(today);
  const [day, setDay] = useState(initialDay && days.includes(initialDay) ? initialDay : today);
  // "I worked from …" for this day: the default for what is added.
  const [chosen, setChosen] = useState<WorkLocation | null>(null);
  useEffect(() => setChosen(null), [day]);
  const key = ['attendance', 'day', day];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<MyDay>(`/attendance/day/${day}`) });
  const put = (d: MyDay) => {
    qc.setQueryData(['attendance', 'day', d.day], d);
    void qc.invalidateQueries({ queryKey: ['attendance', 'month'] });
  };
  const fail = (what: string) => (err: unknown) =>
    toast(err instanceof ApiError ? err.message : `Could not ${what}.`, 'error');

  const place = useMutation({
    mutationFn: (location: WorkLocation) =>
      apiFetch<MyDay>(`/attendance/day/${day}/location`, { method: 'POST', body: { location } }),
    onSuccess: put,
    onError: fail('save where you worked'),
  });
  const change = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { minutes?: number; location?: WorkLocation };
    }) => apiFetch<MyDay>(`/attendance/entries/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: put,
    onError: fail('change the row'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<MyDay>(`/attendance/entries/${id}`, { method: 'DELETE' }),
    onSuccess: put,
    onError: fail('take the row out'),
  });

  const d = q.data;
  const unplaced = d?.entries.filter((e) => !e.location && (e.editable || e.locationOnly)) ?? [];
  // The place most of the day was worked: the default for what is added next.
  const usual = useMemo<WorkLocation | null>(() => {
    if (!d) return null;
    const best = LOCATION_ORDER.map((l) => [l, d.byLocation[l] ?? 0] as const).sort(
      (a, b) => b[1] - a[1],
    )[0]!;
    return best[1] > 0 ? best[0] : null;
  }, [d]);
  const busy = place.isPending || change.isPending || remove.isPending;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Day">
        {days.map((x, i) => (
          <Button
            key={x}
            size="sm"
            role="tab"
            aria-selected={day === x}
            variant={day === x ? 'primary' : 'secondary'}
            onClick={() => setDay(x)}
          >
            {i === 0 ? 'Today' : i === 1 ? 'Yesterday' : dayLabel(x)}
          </Button>
        ))}
      </div>

      {q.isLoading && <Spinner label="Loading your day…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load your day.'}
        </EmptyState>
      )}
      {d && (
        <>
          <DaySummary day={d} />

          {d.editable && (unplaced.length > 0 || !usual) && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium text-ink">
                  Where did you work {day === today ? 'today' : 'this day'}?
                </p>
                <p className="text-xs text-ink-muted">
                  {unplaced.length > 0
                    ? `Sets it on the ${unplaced.length} row${unplaced.length === 1 ? '' : 's'} not placed yet (your task clocks), and on what you add.`
                    : 'It is used for what you add; each row can still say otherwise.'}
                </p>
              </div>
              <LocationPicker
                size="sm"
                label="Where you worked"
                value={chosen}
                onChange={(l) => {
                  setChosen(l);
                  if (unplaced.length > 0) place.mutate(l);
                }}
              />
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <Clock className="h-4 w-4 text-ink-faint" aria-hidden /> What you did
              </h2>
              <span className="text-xs text-ink-muted">
                Task clocks are counted already — add only what they missed.
              </span>
            </div>
            {d.entries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">
                Nothing on this day yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {d.entries.map((e) => (
                  <EntryRow
                    key={`${e.id}:${e.seconds}`}
                    entry={e}
                    busy={busy}
                    onChange={
                      d.editable ? (patch) => change.mutate({ id: e.id, patch }) : undefined
                    }
                    onRemove={d.editable ? () => remove.mutate(e.id) : undefined}
                  />
                ))}
              </ul>
            )}
          </Card>

          {d.editable ? (
            <LogForm day={day} location={chosen ?? usual} onLogged={put} />
          ) : (
            <EmptyState>
              This day can no longer be changed. Rows can be added for today and the last 3 days.
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
