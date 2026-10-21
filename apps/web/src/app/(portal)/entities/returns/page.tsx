'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION } from '@hsdg/contracts';
import { Upload } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import {
  ReturnsGrid,
  filterReturnLines,
  returnCounts,
  useClientReturns,
} from '@/components/entities/client-returns';

/** ADR-0035 — every client's GST returns as the firm's sheet marks them, like the sheet. */
export default function ClientReturnsPage(): JSX.Element {
  const { principal } = useAuth();
  const q = useClientReturns();
  const [search, setSearch] = useState('');
  const [onlyNa, setOnlyNa] = useState(false);

  const lines = useMemo(() => {
    const found = filterReturnLines(q.data?.lines ?? [], search);
    return onlyNa ? found.filter((l) => returnCounts([l]).notApplicable > 0) : found;
  }, [q.data, search, onlyNa]);
  const clients = new Set(q.data?.lines.map((l) => l.entityId)).size;
  const { filed, notApplicable } = returnCounts(q.data?.lines ?? []);

  return (
    <div>
      <PageHeader
        back={{ href: '/entities', label: 'Clients' }}
        title="GST returns"
        subtitle="GSTR-1 and GSTR-3B filed or not applicable, month by month and quarter by quarter, as marked in the firm's GST login sheet."
        actions={
          can(principal, PERMISSION.entityManage) && can(principal, PERMISSION.credentialManage) ? (
            <Link href="/entities/import">
              <Button variant="secondary">
                <Upload className="h-4 w-4" /> Import the sheet again
              </Button>
            </Link>
          ) : undefined
        }
      />

      {q.isLoading && <Spinner />}
      {q.data && q.data.lines.length === 0 && (
        <EmptyState>
          No GST return history yet. Import the firm&rsquo;s login workbook (Clients → Import client
          logins): its filed / NA marks show here.
        </EmptyState>
      )}
      {q.data && q.data.lines.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client or GSTIN…"
              className="w-full max-w-sm rounded-md border border-line-strong px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <label className="flex items-center gap-1.5 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={onlyNa}
                onChange={(e) => setOnlyNa(e.target.checked)}
              />
              Only with an NA
            </label>
            <span className="text-sm text-ink-muted">
              {clients} clients · {filed} filed · {notApplicable} NA
            </span>
          </div>
          <Card className="p-0">
            {lines.length === 0 ? (
              <p className="p-4 text-sm text-ink-faint">No client matches.</p>
            ) : (
              <ReturnsGrid data={q.data} lines={lines} showClient />
            )}
          </Card>
          <p className="mt-2 text-xs text-ink-faint">
            ✓ filed · NA not applicable · a dot: nothing in the sheet. A client with no GSTIN in the
            sheet shows by its state; once its GSTIN is added the marks move under it.
          </p>
        </>
      )}
    </div>
  );
}
