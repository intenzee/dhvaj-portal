'use client';

import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { EmptyState, PageHeader } from '@/components/ui';
import { GstClientImport } from '@/components/entities/gst-import';

/** ADR-0035 — bring a spreadsheet of GST clients and their portal logins into the portal. */
export default function ImportGstClientsPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed =
    can(principal, PERMISSION.entityManage) && can(principal, PERMISSION.credentialManage);
  return (
    <div>
      <PageHeader
        title="Import GST clients"
        subtitle="Add clients, their GSTINs and GST portal logins from a spreadsheet. Clients sharing a PAN become one client."
      />
      {allowed ? (
        <GstClientImport />
      ) : (
        <EmptyState>Only partners and managers can import clients.</EmptyState>
      )}
    </div>
  );
}
