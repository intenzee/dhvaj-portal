'use client';

import { useState } from 'react';
import { monthOf, useIsPayApprover } from '@/lib/payroll';
import { Card, CardBody, PageHeader } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { StatutoryTable } from '@/components/payroll/books';

/** PF, ESI, PT and TDS for a month — due dates, and the challan once the Accountant deposits it. */
export default function PayrollStatutoryPage(): JSX.Element {
  const approver = useIsPayApprover();
  const [month, setMonth] = useState(monthOf(-1));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Statutory dues"
        subtitle="Worked out from the approved runs. PF and ESI are due by the 15th of the next month, TDS by the 7th (30 April for March), PT by the month end."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      <Card>
        <CardBody className="space-y-4 p-0">
          <div className="border-b border-line p-3">
            <Field label="Month">
              <Input type="month" className="w-48" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          </div>
          {/^\d{4}-\d{2}$/.test(month) && <StatutoryTable month={month} canRecord={approver} />}
        </CardBody>
      </Card>
    </div>
  );
}
