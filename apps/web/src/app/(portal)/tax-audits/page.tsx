'use client';

import { PageHeader } from '@/components/ui';
import { TaxAuditRadar } from '@/components/tax-audit/tax-audit-radar';
import { istToday } from '@/lib/people';

export default function TaxAuditsPage(): JSX.Element {
  return (
    <div>
      <PageHeader
        title="Tax audit radar"
        subtitle="Clients likely to need a tax audit (s.44AB), with the reason, and whether it is in their scope."
      />
      <TaxAuditRadar today={istToday()} />
    </div>
  );
}
