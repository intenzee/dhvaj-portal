'use client';

import Link from 'next/link';
import { History } from 'lucide-react';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';

/** "Change log" for a client or an engagement — Managing Partner and administrators only. */
export function ChangeLogLink({
  entityId,
  engagementId,
}: {
  entityId?: string;
  engagementId?: string;
}): JSX.Element | null {
  const { principal } = useAuth();
  if (!can(principal, PERMISSION.auditRead)) return null;
  const q = engagementId ? `engagementId=${engagementId}` : `entityId=${entityId ?? ''}`;
  return (
    <Link
      href={`/change-log?${q}`}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
    >
      <History className="h-4 w-4" /> Change log
    </Link>
  );
}
