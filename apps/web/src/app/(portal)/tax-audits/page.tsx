'use client';

import { canSeeTaxAuditBoard } from '@hsdg/contracts';
import { PageHeader } from '@/components/ui';
import { TaxAuditBoardPanel } from '@/components/tax-audit/tax-audit-board';
import { TaxAuditRadar } from '@/components/tax-audit/tax-audit-radar';
import { useAuth } from '@/lib/auth';
import { istToday } from '@/lib/people';

export default function TaxAuditsPage(): JSX.Element {
  const { principal } = useAuth();
  // F-9: the board is for the Managing Partner and Partners.
  const board = canSeeTaxAuditBoard(principal?.effectiveRole);
  return (
    <div>
      <PageHeader
        title="Tax audit radar"
        subtitle="Clients likely to need a tax audit (s.44AB), with the reason, and whether it is in their scope."
      />
      <TaxAuditRadar today={istToday()} />
      {board && (
        <div className="mt-6">
          <TaxAuditBoardPanel today={istToday()} />
        </div>
      )}
    </div>
  );
}
