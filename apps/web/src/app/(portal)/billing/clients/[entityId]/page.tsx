'use client';

import { useParams } from 'next/navigation';
import { ClientStatement } from '@/components/billing/client-statement';

/** PS-202 · a client's statement, from Billing & Collections. */
export default function ClientStatementPage(): JSX.Element {
  const { entityId } = useParams<{ entityId: string }>();
  return <ClientStatement entityId={entityId} back={{ href: '/billing', label: 'Billing & Collections' }} />;
}
