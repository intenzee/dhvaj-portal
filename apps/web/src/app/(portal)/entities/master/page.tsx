'use client';

import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { EmptyState, PageHeader } from '@/components/ui';
import { ClientMaster, ExportClientMasterButton } from '@/components/entities/client-master';

/** Export the clients to the Client Master workbook, fill the gaps, import it back. */
export default function ClientMasterPage(): JSX.Element {
  const { principal } = useAuth();
  const manage = can(principal, PERMISSION.entityManage);
  const importer = manage && can(principal, PERMISSION.credentialManage);
  return (
    <div>
      <PageHeader
        title="Client master"
        subtitle="Every client's PAN, GSTINs, TAN, CIN, contact, address and services in one Excel file. Export it, fill in what is missing or add new clients, and import it back."
      />
      {importer ? (
        <ClientMaster />
      ) : manage ? (
        <EmptyState>
          <span className="block">You can export the client master.</span>
          <span className="mt-3 inline-block">
            <ExportClientMasterButton variant="primary" />
          </span>
          <span className="mt-3 block text-xs">
            Importing it back is for partners and managers.
          </span>
        </EmptyState>
      ) : (
        <EmptyState>Only partners and managers can export or import clients.</EmptyState>
      )}
    </div>
  );
}
