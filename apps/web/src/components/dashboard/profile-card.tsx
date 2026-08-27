'use client';

import Link from 'next/link';
import { PlusCircle, ListTodo, Building2, Upload, MessageSquareWarning, ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { initials, roleLabel } from '@/lib/principal';
import { Card } from '@/components/ui';

const ACTIONS = [
  { label: 'Create Engagement', href: '/engagements/new', icon: PlusCircle },
  { label: 'My Tasks', href: '/tasks', icon: ListTodo },
  { label: 'Add Entity', href: '/entities', icon: Building2 },
  { label: 'Review Queue', href: '/reviews', icon: ClipboardCheck },
  { label: 'Upload Document', href: '/documents', icon: Upload },
  { label: 'Client Dependencies', href: '/client-dependencies', icon: MessageSquareWarning },
];

export function ProfileCard(): JSX.Element {
  const { principal } = useAuth();
  if (!principal) return <Card className="p-5" />;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
          {initials(principal.displayName)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{principal.displayName}</div>
          <div className="text-xs text-ink-muted">{roleLabel(principal.effectiveRole)}</div>
          <div className="truncate text-xs text-ink-faint">{principal.email}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 py-3 text-xs">
        <Fact label="Office" value={principal.officeCode} />
        <Fact label="MFA" value={principal.mfaSatisfied ? 'Satisfied' : 'Required'} />
      </div>

      <div className="border-t border-line px-5 py-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Quick Actions
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-primary-50 hover:text-primary-700"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{a.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="font-medium text-ink">{value}</div>
    </div>
  );
}
