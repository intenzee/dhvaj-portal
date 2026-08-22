'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronRight } from 'lucide-react';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import type { ComplianceRule, Holiday } from '@/lib/types';
import { PageHeader, Card, Spinner, EmptyState, Button, Badge } from '@/components/ui';
import { CreateRuleModal, AddVersionModal, AddHolidayModal } from '@/components/compliance/rule-modals';

type Tab = 'rules' | 'holidays';

export default function ComplianceConfigPage(): JSX.Element {
  const { principal } = useAuth();
  const [tab, setTab] = useState<Tab>('rules');

  if (!can(principal, PERMISSION.complianceManage)) {
    return (
      <div>
        <PageHeader title="Compliance configuration" />
        <EmptyState>You don’t have permission to configure compliance rules.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Compliance configuration"
        subtitle="Rules, effective-dated versions and the holiday calendar. Statutory dates are data, not code."
        actions={
          <Link href="/compliance" className="text-sm text-primary-600 hover:underline">
            ← Back to calendar
          </Link>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(['rules', 'holidays'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium capitalize transition',
              tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'rules' ? <RulesPanel /> : <HolidaysPanel />}
    </div>
  );
}

function RulesPanel(): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingVersionTo, setAddingVersionTo] = useState<ComplianceRule | null>(null);

  const rules = useQuery({
    queryKey: ['compliance', 'rules'],
    queryFn: () => apiFetch<Paginated<ComplianceRule>>('/compliance-rules?limit=100'),
  });

  const toggleActive = useMutation({
    mutationFn: (r: ComplianceRule) =>
      apiFetch(`/compliance-rules/${r.id}/active`, { method: 'PATCH', body: { isActive: !r.isActive } }),
    onSuccess: () => {
      toast('Rule updated.');
      void qc.invalidateQueries({ queryKey: ['compliance', 'rules'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the rule.', 'error'),
  });

  if (rules.isLoading) return <Spinner label="Loading rules…" />;

  const items = rules.data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New rule
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState>No compliance rules yet.</EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100">
          {items.map((r) => {
            const open = expanded === r.id;
            const current = currentVersion(r);
            return (
              <div key={r.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpanded(open ? null : r.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight className={cn('h-4 w-4 shrink-0 text-ink-faint transition', open && 'rotate-90')} />
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {r.name} <span className="text-ink-faint">({r.code})</span>
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {humanize(r.category)}
                        {r.serviceCode ? ` · ${r.serviceCode}` : ''} · {r.versions.length} version
                        {r.versions.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </button>
                  <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                  <Button size="sm" variant="ghost" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate(r)}>
                    {r.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAddingVersionTo(r)}>
                    <Plus className="h-3.5 w-3.5" /> Version
                  </Button>
                </div>

                {open && (
                  <div className="bg-slate-50/60 px-4 py-3">
                    {r.versions.length === 0 ? (
                      <p className="text-sm text-ink-faint">No versions — this rule is not yet effective.</p>
                    ) : (
                      <div className="scroll-slim overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-ink-faint">
                              <th className="py-1 pr-4 font-semibold">Effective</th>
                              <th className="py-1 pr-4 font-semibold">Basis</th>
                              <th className="py-1 pr-4 font-semibold">Offset</th>
                              <th className="py-1 pr-4 font-semibold">Wk-day adj</th>
                              <th className="py-1 pr-4 font-semibold">SLA buffer</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.versions.map((v) => (
                              <tr key={v.id} className={cn('border-t border-slate-200', current?.id === v.id && 'font-medium text-ink')}>
                                <td className="py-1 pr-4">
                                  {formatDate(v.effectiveFrom)} → {v.effectiveTo ? formatDate(v.effectiveTo) : 'open'}
                                  {current?.id === v.id && <span className="ml-1 text-primary-600">(current)</span>}
                                </td>
                                <td className="py-1 pr-4">{humanize(v.calculationBasis)}</td>
                                <td className="py-1 pr-4">
                                  {v.fixedMonth ? `${v.fixedDay}/${v.fixedMonth}` : `${v.offsetMonths}m ${v.offsetDays}d`}
                                </td>
                                <td className="py-1 pr-4">{humanize(v.workingDayAdjustment)}</td>
                                <td className="py-1 pr-4">{v.internalSlaOffsetDays}d</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {creating && <CreateRuleModal onClose={() => setCreating(false)} />}
      {addingVersionTo && <AddVersionModal rule={addingVersionTo} onClose={() => setAddingVersionTo(null)} />}
    </div>
  );
}

function HolidaysPanel(): JSX.Element {
  const [adding, setAdding] = useState(false);
  const holidays = useQuery({
    queryKey: ['compliance', 'holidays'],
    queryFn: () => apiFetch<Holiday[]>('/compliance-holidays'),
  });

  if (holidays.isLoading) return <Spinner label="Loading holidays…" />;
  const items = holidays.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add holiday
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState>No holidays in the calendar.</EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100">
          {items.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{h.name}</span>
              <span className="text-ink-muted">{formatDate(h.holidayDate)}</span>
            </div>
          ))}
        </Card>
      )}

      {adding && <AddHolidayModal onClose={() => setAdding(false)} />}
    </div>
  );
}

/** The version effective today (latest whose window contains now), else the newest. */
function currentVersion(rule: ComplianceRule): ComplianceRule['versions'][number] | null {
  const today = new Date().toISOString().slice(0, 10);
  const active = rule.versions
    .filter((v) => v.effectiveFrom <= today && (!v.effectiveTo || v.effectiveTo >= today))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (active[0]) return active[0];
  const byRecency = [...rule.versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return byRecency[0] ?? null;
}
