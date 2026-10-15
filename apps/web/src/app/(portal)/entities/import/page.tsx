'use client';

import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { EmptyState, PageHeader } from '@/components/ui';
import { ClientImport } from '@/components/entities/client-import';

/** ADR-0035 — bring the firm's login workbook (GST and TDS logins) into the portal. */
export default function ImportClientLoginsPage(): JSX.Element {
  const { principal } = useAuth();
  const allowed =
    can(principal, PERMISSION.entityManage) && can(principal, PERMISSION.credentialManage);
  return (
    <div>
      <PageHeader
        title="Import client logins"
        subtitle="Add clients, their GSTINs and TANs, and their GST, income-tax and TRACES logins from the firm's login workbook. Rows sharing a PAN or name become one client."
      />
      {allowed ? (
        <ClientImport />
      ) : (
        <EmptyState>Only partners and managers can import clients.</EmptyState>
      )}
    </div>
  );
}
