'use client';

import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { PeopleSection } from '@/components/admin/people-section';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { EmptyState, PageHeader } from '@/components/ui';

/** Everyone in the firm; a row opens the person (profile, articleship, login, hours). */
export default function EmployeesPage(): JSX.Element {
  const { principal } = useAuth();
  if (!can(principal, PERMISSION.employeeRead)) {
    return (
      <div>
        <PageHeader title="Employees" />
        <EmptyState>You don’t have access to the employee list.</EmptyState>
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Who is in the firm: grade, office, login and status."
      />
      <PeopleSubnav />
      <PeopleSection rowHref={(e) => `/people/employees/${e.id}`} />
    </div>
  );
}
