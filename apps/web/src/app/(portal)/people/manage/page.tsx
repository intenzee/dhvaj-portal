'use client';

import { PERMISSION } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { PeopleSubnav } from '@/components/people/people-subnav';
import { PeopleScreen } from '@/components/people/people-screen';
import { EmptyState, PageHeader } from '@/components/ui';

/** B-2: everyone in one editable table, the org chart and the day-one clean-up list. */
export default function ManagePeoplePage(): JSX.Element {
  const { principal } = useAuth();
  // user.manage: the Managing Partner and the administrator.
  if (!can(principal, PERMISSION.userManage)) {
    return (
      <div>
        <PageHeader title="Manage people" />
        <EmptyState>Only the Managing Partner or an administrator manages people here.</EmptyState>
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title="Manage people"
        subtitle="Grade, main role, add-ons, reporting line and office for everyone, in one place. Grade is what they are paid at; the main role is what they can do."
      />
      <PeopleSubnav />
      <PeopleScreen />
    </div>
  );
}
