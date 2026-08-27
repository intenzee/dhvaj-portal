'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { openComplianceQuery } from '@/lib/queries';
import { Card, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ComplianceMiniCalendar(): JSX.Element {
  const q = useQuery(openComplianceQuery);
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });

  // Map "YYYY-M-D" → worst severity that day (overdue beats upcoming).
  const marks = useMemo(() => {
    const map = new Map<number, 'overdue' | 'upcoming'>();
    for (const r of q.data?.items ?? []) {
      const d = new Date(r.effectiveStatutoryDeadline);
      if (d.getFullYear() !== view.y || d.getMonth() !== view.m) continue;
      const sev = r.isStatutoryOverdue ? 'overdue' : 'upcoming';
      if (sev === 'overdue' || !map.has(d.getDate())) map.set(d.getDate(), sev);
    }
    return map;
  }, [q.data, view]);

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const step = (delta: number) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  const isToday = (day: number) =>
    view.y === today.getFullYear() && view.m === today.getMonth() && day === today.getDate();

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h3 className="text-[15px] font-semibold text-ink">Compliance Calendar</h3>
        <Link
          href="/compliance"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
        >
          View calendar <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="px-5 py-4">
        {q.isLoading ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <button onClick={() => step(-1)} className="rounded p-1 text-ink-muted hover:bg-surface-sunken" aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-semibold text-ink">
                {MONTHS[view.m]} {view.y}
              </div>
              <button onClick={() => step(1)} className="rounded p-1 text-ink-muted hover:bg-surface-sunken" aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint">
              {DOW.map((d) => (
                <div key={d} className="py-1 font-medium">{d}</div>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <div key={`b${i}`} />;
                const sev = marks.get(day);
                return (
                  <div
                    key={day}
                    className={cn(
                      'flex h-8 items-center justify-center rounded-md text-[13px]',
                      sev === 'overdue' && 'bg-danger-500 font-semibold text-white',
                      sev === 'upcoming' && 'bg-warning-500 font-semibold text-white',
                      !sev && 'text-ink',
                      isToday(day) && !sev && 'ring-1 ring-primary-500 font-semibold text-primary-700',
                      isToday(day) && sev && 'ring-2 ring-offset-1 ring-primary-600',
                    )}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Overdue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Due
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
