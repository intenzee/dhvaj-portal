'use client';

import { PageHeader } from '@/components/ui';
import { AssignWorkScreen } from '@/components/work-sets/assign-work';

export default function WorkSetsPage(): JSX.Element {
  return (
    <div>
      <PageHeader
        title="Assign work"
        subtitle="Give a batch of open tasks to one person as a named set, and follow who holds each piece."
      />
      <AssignWorkScreen />
    </div>
  );
}
