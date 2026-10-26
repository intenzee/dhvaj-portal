import { Injectable } from '@nestjs/common';
import {
  annualFee,
  financialYearOf,
  fromPaise,
  toPaise,
  type BillingFrequency,
  type ClientFeeRow,
  type ClientFees,
  type FeePeriod,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';

interface FeeRow {
  engagement_id: string;
  engagement_code: string;
  service_name: string | null;
  financial_year: string;
  fee_amount: string | null;
  fee_period: FeePeriod;
  fee_period_set_at: Date | null;
  billing_frequency: BillingFrequency | null;
  year_version: number;
  invoiced: string;
}

/**
 * CM-4 · Client 360's Fees card: each open engagement's fee for the current
 * year, with the period it is typed for, how often it is invoiced, its year's
 * value and what is still unbilled. Rows follow the caller's RLS (the billing
 * header view lets an Accountant see the engagements it may bill).
 */
@Injectable()
export class ClientFeesService {
  constructor(private readonly db: DatabaseService) {}

  async forClient(ctx: RlsContext, entityId: string, canEdit: boolean): Promise<ClientFees> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: today } = await client.query<{ d: string }>(
        `SELECT timezone('Asia/Kolkata', now())::date::text AS d`,
      );
      const fy = financialYearOf(today[0]!.d);
      const { rows } = await client.query<FeeRow>(
        `SELECT e.id AS engagement_id, e.engagement_code, e.service_name, y.financial_year,
                y.fee_amount::text, y.fee_period, y.fee_period_set_at, ec.billing_frequency,
                y.version AS year_version,
                (SELECT COALESCE(sum(i.total), 0) FROM hsdg.invoices i
                  WHERE i.engagement_id = e.id
                    AND i.status IN ('issued', 'partially_paid', 'paid')
                    AND i.issue_date BETWEEN make_date(left($2, 4)::int, 4, 1)
                                         AND make_date(left($2, 4)::int + 1, 3, 31))::text AS invoiced
           FROM hsdg.engagement_billing_headers e
           JOIN hsdg.compliance_engagement_years y
             ON y.engagement_id = e.id AND y.financial_year = $2
           LEFT JOIN hsdg.engagement_commercial ec ON ec.engagement_id = e.id
          WHERE e.entity_id = $1
            AND e.status IN ('accepted', 'active', 'on_hold')
          ORDER BY e.service_name NULLS LAST, e.engagement_code`,
        [entityId, fy],
      );
      return { financialYear: fy, canEdit, rows: rows.map(toRow) };
    });
  }
}

function toRow(r: FeeRow): ClientFeeRow {
  const year = annualFee(r.fee_amount, r.fee_period);
  const unbilled = year === null ? null : fromPaise(maxZero(toPaise(year) - toPaise(r.invoiced)));
  return {
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    serviceName: r.service_name ?? 'Engagement',
    financialYear: r.financial_year,
    feeAmount: r.fee_amount,
    feePeriod: r.fee_period,
    billingFrequency: r.billing_frequency,
    annualFee: year,
    unbilled,
    yearVersion: r.year_version,
    feePeriodSetAt: r.fee_period_set_at ? r.fee_period_set_at.toISOString() : null,
  };
}

const maxZero = (p: bigint): bigint => (p < 0n ? 0n : p);
