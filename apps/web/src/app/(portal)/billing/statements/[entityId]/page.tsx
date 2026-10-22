'use client';

import { useParams } from 'next/navigation';
import { ClientStatement } from '@/components/billing/client-statement';
import { BillingProfileCard } from '@/components/accounts/billing-profile-card';

/** Accountant role · a client's billing profile above its statement (spec §3.4). */
export default function StatementPage(): JSX.Element {
  const { entityId } = useParams<{ entityId: string }>();
  return (
    <ClientStatement
      entityId={entityId}
      back={{ href: '/billing/statements', label: 'Client statements' }}
      aside={<BillingProfileCard entityId={entityId} />}
    />
  );
}
