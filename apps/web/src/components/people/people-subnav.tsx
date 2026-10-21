'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { readsPeople } from '@/lib/people';
import { cn } from '@/lib/cn';

/**
 * The People area's own tabs, gated as the sidebar gates them (every role holds
 * employee.read, so the area itself is employee.manage).
 */
export function PeopleSubnav(): JSX.Element {
  const { principal } = useAuth();
  const pathname = usePathname() ?? '';
  const people = readsPeople(principal);
  const links: Array<{ href: string; label: string; show: boolean }> = [
    { href: '/people', label: 'Desk', show: can(principal, PERMISSION.employeeManage) },
    {
      href: '/people/employees',
      label: 'Employees',
      show: can(principal, PERMISSION.employeeManage),
    },
    { href: '/people/articles', label: 'Articles', show: can(principal, PERMISSION.employeeManage) },
    {
      href: '/people/joiners-leavers',
      label: 'Joiners & leavers',
      show: can(principal, PERMISSION.employeeManage),
    },
    { href: '/people/attendance', label: 'Attendance', show: people },
    {
      href: '/people/workload',
      label: 'Workload',
      show: can(principal, PERMISSION.reportReadPeople),
    },
    {
      href: '/people/reports',
      label: 'Reports',
      show: can(principal, PERMISSION.reportReadPeople),
    },
  ];
  const active = (href: string): boolean =>
    href === '/people' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="People" className="mb-4 flex flex-wrap gap-1 border-b border-line-strong">
      {links
        .filter((l) => l.show)
        .map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active(l.href) ? 'page' : undefined}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition',
              active(l.href)
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {l.label}
          </Link>
        ))}
    </nav>
  );
}

/** A labelled number, as on the reports page. */
export function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
}): JSX.Element {
  const color =
    tone === 'danger'
      ? 'text-danger-600'
      : tone === 'warn'
        ? 'text-warning-700'
        : tone === 'success'
          ? 'text-success-700'
          : 'text-ink';
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div className={cn('mt-1 text-3xl font-bold tabular-nums', color)}>{value}</div>
    </div>
  );
}
