'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can, type Principal } from '@/lib/principal';
import { PeopleSection } from '@/components/admin/people-section';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { NewJoinerModal } from '@/components/people/new-joiner-modal';
import { Button, EmptyState, PageHeader } from '@/components/ui';

function mayOnboard(principal: Principal | null): boolean {
  return (
    can(principal, PERMISSION.employeeManage) &&
    (can(principal, PERMISSION.userOnboard) || can(principal, PERMISSION.userManage))
  );
}

/** Everyone in the firm; a row opens the person (profile, articleship, login, hours). */
export default function EmployeesPage(): JSX.Element {
  const { principal } = useAuth();
  const [joining, setJoining] = useState(false);
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
        actions={
          mayOnboard(principal) ? (
            <Button size="sm" onClick={() => setJoining(true)}>
              <UserPlus className="h-4 w-4" /> New joiner
            </Button>
          ) : undefined
        }
      />
      <PeopleSubnav />
      <PeopleSection rowHref={(e) => `/people/employees/${e.id}`} />
      {joining && <NewJoinerModal onClose={() => setJoining(false)} />}
    </div>
  );
}
