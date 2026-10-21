'use client';

import { useQuery } from '@tanstack/react-query';
import type { ClientBillingProfile } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { stateLabel } from '@/components/billing/invoice-gst';
import { addressLine, profileGaps } from './accounts';

/**
 * What an invoice for this client needs (spec §3.4): name, PAN, GSTIN,
 * address, billing contact. Nothing else of the client master.
 */
export function BillingProfileCard({ entityId }: { entityId: string }): JSX.Element | null {
  const profile = useQuery({
    queryKey: ['billing', 'profile', entityId],
    queryFn: () => apiFetch<ClientBillingProfile>(`/billing/clients/${entityId}/profile`),
  });
  // The statement below says why when the client is out of reach.
  if (!profile.data) return null;
  const p = profile.data;
  const gaps = profileGaps(p);

  return (
    <Card className="mb-3">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Billing profile</CardTitle>
        <span className="text-xs text-ink-faint">{p.entityCode}</span>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-4">
          <Fact label="Legal name" value={p.legalName} />
          <Fact label="PAN" value={p.pan} />
          <Fact
            label="GSTIN"
            value={p.gstin ?? (p.gstinCount > 1 ? `${p.gstinCount} active` : 'Unregistered')}
          />
          <Fact label="Place of supply" value={p.stateCode ? stateLabel(p.stateCode) : null} />
          <Fact label="Billing address" value={addressLine(p)} wide />
          <Fact
            label="Billing contact"
            value={[p.contact.name, p.contact.email, p.contact.phone].filter(Boolean).join(' · ') || null}
          />
          <Fact label="Credit terms" value={p.creditTermsDays != null ? `${p.creditTermsDays} days` : null} />
        </dl>
        {gaps.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-700">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Fact({ label, value, wide }: { label: string; value: string | null; wide?: boolean }): JSX.Element {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{value ?? <span className="text-ink-faint">—</span>}</dd>
    </div>
  );
}
