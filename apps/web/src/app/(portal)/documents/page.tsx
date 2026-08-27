'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import { DOCUMENT_STATUSES, type Paginated } from '@hsdg/contracts';
import { apiFetch, downloadFile } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { GlobalDocumentRow } from '@/lib/types';
import { cn } from '@/lib/cn';
import { PageHeader, Spinner, Card, Button } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';

const PAGE_SIZE = 25;

export default function DocumentsPage(): JSX.Element {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [offset, setOffset] = useState(0);

  const reset = (fn: () => void): void => {
    fn();
    setOffset(0);
  };

  const q = useQuery({
    queryKey: ['documents', 'global', search, status, offset],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      return apiFetch<Paginated<GlobalDocumentRow>>(`/documents?${params.toString()}`);
    },
  });

  const download = async (d: GlobalDocumentRow): Promise<void> => {
    try {
      await downloadFile(
        `/engagements/${d.engagementId}/documents/${d.id}/download`,
        d.currentFilename ?? 'document',
      );
    } catch {
      toast('Could not download the document.', 'error');
    }
  };

  const columns: ColumnDef<GlobalDocumentRow, unknown>[] = [
    {
      header: 'Document',
      cell: ({ row }) => (
        <div>
          <span className="block font-medium text-ink">{row.original.title}</span>
          <span className="block text-xs text-ink-faint">
            {humanize(row.original.documentType)} · v{row.original.currentVersionNo}
          </span>
        </div>
      ),
    },
    {
      header: 'Client',
      cell: ({ row }) => row.original.entityName ?? <span className="text-ink-faint">—</span>,
    },
    {
      header: 'Engagement',
      cell: ({ row }) => (
        <Link
          href={`/engagements/${row.original.engagementId}`}
          className="font-medium text-primary-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.engagementCode}
        </Link>
      ),
    },
    { header: 'Classification', cell: ({ row }) => humanize(row.original.classification) },
    { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { header: 'Added', cell: ({ row }) => formatDate(row.original.createdAt) },
    {
      header: '',
      id: 'download',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            void download(row.original);
          }}
        >
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Documents" subtitle="Evidence across every engagement you can access." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => reset(() => setSearch(e.target.value))}
          placeholder="Search by title…"
          className="w-full max-w-xs rounded-md border border-line-strong px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <FilterChip label="All statuses" active={status === ''} onClick={() => reset(() => setStatus(''))} />
        {DOCUMENT_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={humanize(s)}
            active={status === s}
            onClick={() => reset(() => setStatus(s))}
          />
        ))}
      </div>

      <Card className="p-0">
        {q.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {q.data && (
          <DataTable columns={columns} data={q.data.items} empty="No documents match this view." />
        )}
      </Card>
      {q.data && (
        <Pagination
          total={q.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          unit="documents"
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
      )}
    >
      {label}
    </button>
  );
}
