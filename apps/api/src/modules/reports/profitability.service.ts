import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PROFITABILITY_BY_LABEL,
  lastQuarter,
  type EmployeeRateRow,
  type ProfitabilityBy,
  type ProfitabilityQuery,
  type ProfitabilityReport,
  type PutEmployeeRateInput,
  type PutRateCardsInput,
  type PutWorkingCalendarInput,
  type RateCardRow,
  type RateCardsResponse,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import { istToday } from '../engagements/time/auto-time';
import {
  profitability,
  profitabilityCsv,
  toPaise,
  type EngagementMeta,
  type MoneyFact,
  type ProfitabilityResult,
  type RateBook,
  type RateFrom,
  type TimeFact,
} from './profitability-math';

const FINANCE_ONLY = 'Only the Managing Partner and the partners see and set rates.';
const MAX_DAYS = 731;

/** The engagement filters every fact query shares. `$1` from, `$2` to; the rest from 3. */
function engagementFilter(q: ProfitabilityQuery, args: unknown[]): string {
  const where: string[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (q.partnerId) where.push(`e.engagement_partner_id = ${arg(q.partnerId)}`);
  if (q.officeId) where.push(`e.office_id = ${arg(q.officeId)}`);
  if (q.entityId) where.push(`e.entity_id = ${arg(q.entityId)}`);
  return where.length ? `AND ${where.join(' AND ')}` : '';
}

const PRIMARY_SERVICE = `(SELECT es.service_id FROM hsdg.engagement_services es
                           WHERE es.engagement_id = e.id
                           ORDER BY es.is_primary DESC, es.created_at LIMIT 1)`;

/**
 * Practice Services PS-302 — rate cards, the working calendar and the
 * profitability report. Rates are FORCE RLS on practice.finance; the report's
 * time, invoices and receipts are the caller's own view (RLS), so an office
 * partner sees their office and the Managing Partner the firm.
 */
@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Rate cards ──────────────────────────────────────────────────────────

  async rateCards(ctx: RlsContext): Promise<RateCardsResponse> {
    return this.db.withRlsContext(ctx, (client) => this.readRateCards(client));
  }

  async putRateCards(ctx: RlsContext, input: PutRateCardsInput): Promise<RateCardsResponse> {
    if (input.rates.length === 0) throw new BadRequestException('Give at least one grade’s rates.');
    const grades = new Set(input.rates.map((r) => r.gradeId));
    if (grades.size !== input.rates.length)
      throw new BadRequestException('Each grade once, please.');
    return this.db.withRlsContext(ctx, async (client) => {
      try {
        for (const r of input.rates) {
          await client.query(
            `INSERT INTO hsdg.rate_cards
               (grade_id, financial_year, cost_rate_per_hour, charge_out_rate_per_hour,
                effective_from, created_by)
             VALUES ($1, hsdg.financial_year_of($2::date), $3, $4, $2, $5)
             ON CONFLICT (grade_id, effective_from) DO UPDATE
               SET cost_rate_per_hour = EXCLUDED.cost_rate_per_hour,
                   charge_out_rate_per_hour = EXCLUDED.charge_out_rate_per_hour`,
            [
              r.gradeId,
              input.effectiveFrom,
              r.costRatePerHour,
              r.chargeOutRatePerHour,
              ctx.employeeId ?? null,
            ],
          );
        }
      } catch (err) {
        throw translatePgError(err, {
          forbidden: FINANCE_ONLY,
          foreignKey: 'That grade was not found.',
          check: 'Rates are zero or more.',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'rate_card.set',
        objectType: 'rate_card',
        objectId: input.effectiveFrom,
        after: { effectiveFrom: input.effectiveFrom, rates: input.rates },
      });
      return this.readRateCards(client);
    });
  }

  async deleteRateCard(ctx: RlsContext, id: string): Promise<RateCardsResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query(
        `DELETE FROM hsdg.rate_cards WHERE id = $1 RETURNING grade_id, effective_from::text`,
        [id],
      );
      if (rows[0]) {
        await this.audit.recordWith(client, ctx, {
          action: 'rate_card.removed',
          objectType: 'rate_card',
          objectId: id,
          before: rows[0],
        });
      }
      return this.readRateCards(client);
    });
  }

  async putEmployeeRate(ctx: RlsContext, input: PutEmployeeRateInput): Promise<RateCardsResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      try {
        await client.query(
          `INSERT INTO hsdg.employee_rates
             (employee_id, cost_rate_per_hour, charge_out_rate_per_hour, effective_from, note,
              created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (employee_id, effective_from) DO UPDATE
             SET cost_rate_per_hour = EXCLUDED.cost_rate_per_hour,
                 charge_out_rate_per_hour = EXCLUDED.charge_out_rate_per_hour,
                 note = EXCLUDED.note`,
          [
            input.employeeId,
            input.costRatePerHour,
            input.chargeOutRatePerHour,
            input.effectiveFrom,
            input.note?.trim() || null,
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        throw translatePgError(err, {
          forbidden: FINANCE_ONLY,
          foreignKey: 'That person was not found.',
          check: 'Rates are zero or more.',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'employee_rate.set',
        objectType: 'employee',
        objectId: input.employeeId,
        after: { ...input },
      });
      return this.readRateCards(client);
    });
  }

  async deleteEmployeeRate(ctx: RlsContext, id: string): Promise<RateCardsResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query(
        `DELETE FROM hsdg.employee_rates WHERE id = $1 RETURNING employee_id, effective_from::text`,
        [id],
      );
      if (rows[0]) {
        await this.audit.recordWith(client, ctx, {
          action: 'employee_rate.removed',
          objectType: 'employee',
          objectId: rows[0].employee_id,
          before: rows[0],
        });
      }
      return this.readRateCards(client);
    });
  }

  async putCalendar(ctx: RlsContext, input: PutWorkingCalendarInput): Promise<RateCardsResponse> {
    const days = [...new Set(input.workingWeekdays)].sort();
    return this.db.withRlsContext(ctx, async (client) => {
      let changed = 0;
      try {
        changed =
          (
            await client.query(
              `UPDATE hsdg.firm_settings
                  SET working_weekdays = $1::smallint[], working_hours_per_day = $2`,
              [days, input.workingHoursPerDay],
            )
          ).rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err, {
          forbidden: 'Only the Managing Partner or a partner changes the working calendar.',
          check: 'Working days are 1 (Monday) to 7; hours a day are more than 0 and at most 24.',
        });
      }
      if (changed === 0)
        throw new ForbiddenException(
          'Only the Managing Partner or a partner changes the working calendar.',
        );
      await this.audit.recordWith(client, ctx, {
        action: 'working_calendar.set',
        objectType: 'firm_settings',
        objectId: 'working_calendar',
        after: { workingWeekdays: days, workingHoursPerDay: input.workingHoursPerDay },
      });
      return this.readRateCards(client);
    });
  }

  private async readRateCards(client: PoolClient): Promise<RateCardsResponse> {
    const { rows: grades } = await client.query<{
      id: string;
      slug: string;
      name: string;
      rank: number;
    }>(`SELECT id, slug, name, rank FROM hsdg.grades ORDER BY rank, name`);
    const { rows: cards } = await client.query<{
      id: string;
      grade_id: string;
      grade_name: string;
      financial_year: string;
      cost: string;
      charge: string;
      effective_from: string;
    }>(
      `SELECT rc.id, rc.grade_id, g.name AS grade_name, rc.financial_year,
              rc.cost_rate_per_hour::text AS cost, rc.charge_out_rate_per_hour::text AS charge,
              rc.effective_from::text
         FROM hsdg.rate_cards rc JOIN hsdg.grades g ON g.id = rc.grade_id
        ORDER BY g.rank, rc.effective_from DESC`,
    );
    const { rows: overrides } = await client.query<{
      id: string;
      employee_id: string;
      employee_name: string | null;
      grade_name: string | null;
      cost: string;
      charge: string;
      effective_from: string;
      note: string | null;
    }>(
      `SELECT er.id, er.employee_id, emp.full_name AS employee_name, g.name AS grade_name,
              er.cost_rate_per_hour::text AS cost, er.charge_out_rate_per_hour::text AS charge,
              er.effective_from::text, er.note
         FROM hsdg.employee_rates er
         LEFT JOIN hsdg.employees emp ON emp.id = er.employee_id
         LEFT JOIN hsdg.grades g ON g.id = emp.grade_id
        ORDER BY emp.full_name, er.effective_from DESC`,
    );
    const { rows: cal } = await client.query<{ days: number[]; hours: string }>(
      `SELECT working_weekdays AS days, working_hours_per_day::text AS hours
         FROM hsdg.firm_settings LIMIT 1`,
    );
    return {
      grades,
      cards: cards.map((c): RateCardRow => ({
        id: c.id,
        gradeId: c.grade_id,
        gradeName: c.grade_name,
        financialYear: c.financial_year,
        costRatePerHour: c.cost,
        chargeOutRatePerHour: c.charge,
        effectiveFrom: c.effective_from,
      })),
      overrides: overrides.map((o): EmployeeRateRow => ({
        id: o.id,
        employeeId: o.employee_id,
        employeeName: o.employee_name ?? 'Someone',
        gradeName: o.grade_name,
        costRatePerHour: o.cost,
        chargeOutRatePerHour: o.charge,
        effectiveFrom: o.effective_from,
        note: o.note,
      })),
      calendar: {
        workingWeekdays: (cal[0]?.days ?? [1, 2, 3, 4, 5, 6]).map(Number),
        workingHoursPerDay: cal[0]?.hours ?? '8.00',
      },
    };
  }

  // ── The report ──────────────────────────────────────────────────────────

  async report(ctx: RlsContext, query: ProfitabilityQuery): Promise<ProfitabilityReport> {
    const by = query.by ?? 'client';
    const def = lastQuarter(istToday());
    const from = query.from ?? def.from;
    const to = query.to ?? def.to;
    if (from > to) throw new BadRequestException('The period starts on or before it ends.');
    const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (span > MAX_DAYS) throw new BadRequestException('Choose a period of two years at most.');
    return this.db.withRlsContext(ctx, async (client) => ({
      from,
      to,
      by,
      ...(await computeProfitability(client, from, to, by, query)),
    }));
  }

  async csv(ctx: RlsContext, query: ProfitabilityQuery): Promise<string> {
    const r = await this.report(ctx, query);
    return profitabilityCsv(PROFITABILITY_BY_LABEL[r.by], r.rows, r.totals);
  }
}

/** The report's rows for a period, in the caller's RLS view. */
async function computeProfitability(
  client: PoolClient,
  from: string,
  to: string,
  by: ProfitabilityBy,
  query: ProfitabilityQuery,
): Promise<ProfitabilityResult> {
  const time = await timeFacts(client, from, to, query);
  const money = await moneyFacts(client, from, to, query);
  const engagementIds = [
    ...new Set([...time.map((t) => t.engagementId), ...money.map((m) => m.engagementId)]),
  ];
  const engagements = await engagementMeta(client, engagementIds);
  const serviceIds = [
    ...new Set(
      [
        ...time.map((t) => t.serviceId),
        ...[...engagements.values()].map((e) => e.primaryServiceId),
      ].filter((s): s is string => !!s),
    ),
  ];
  const serviceNames = new Map(
    (
      await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM hsdg.services WHERE id = ANY($1::uuid[])`,
        [serviceIds],
      )
    ).rows.map((s) => [s.id, s.name]),
  );
  const employeeIds = [...new Set(time.map((t) => t.employeeId))];
  const { rates, names } = await rateBook(client, employeeIds);
  const result = profitability({
    by,
    time,
    money,
    engagements,
    serviceNames,
    employeeNames: names,
    rates,
  });
  return result;
}

/** PS-303's partner pack: one partner's month, in the pack's shape. */
export interface PartnerMonthProfitability {
  timeCost: string;
  standardValue: string;
  billed: string;
  realisationPct: number | null;
  margin: string;
}

/**
 * The profitability totals for a period (a partner's month, for the PS-303
 * pack), on `client` already in the caller's RLS context. Optionally one
 * partner's engagements. Null when the caller does not hold
 * practice.finance: without the rates the cost would read as nothing.
 */
export async function partnerMonthProfitability(
  client: PoolClient,
  _ctx: RlsContext,
  opts: { from: string; to: string; partnerId?: string },
): Promise<PartnerMonthProfitability | null> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT hsdg.ctx_has_practice_finance() AS ok`,
  );
  if (!rows[0]?.ok) return null;
  const { totals } = await computeProfitability(client, opts.from, opts.to, 'client', {
    partnerId: opts.partnerId,
  });
  return {
    timeCost: totals.timeCost,
    standardValue: totals.standardValue,
    billed: totals.billed,
    realisationPct: totals.realisationPct,
    margin: totals.margin,
  };
}

async function timeFacts(
  client: PoolClient,
  from: string,
  to: string,
  q: ProfitabilityQuery,
): Promise<TimeFact[]> {
  const args: unknown[] = [from, to];
  const filter = engagementFilter(q, args);
  let serviceFilter = '';
  if (q.serviceId) {
    args.push(q.serviceId);
    serviceFilter = `AND COALESCE(es.service_id, ${PRIMARY_SERVICE}) = $${args.length}`;
  }
  const { rows } = await client.query<{
    engagement_id: string;
    employee_id: string;
    day: string;
    service_id: string | null;
    seconds: string;
    billable: string | null;
  }>(
    `SELECT t.engagement_id, t.employee_id,
            (t.started_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day,
            es.service_id,
            sum(t.duration_seconds) AS seconds,
            sum(t.duration_seconds) FILTER (WHERE t.is_billable) AS billable
       FROM hsdg.effective_time_entries t
       JOIN hsdg.engagements e ON e.id = t.engagement_id
       LEFT JOIN hsdg.engagement_services es ON es.id = t.engagement_service_id
      WHERE t.ended_at IS NOT NULL AND t.duration_seconds > 0
        AND (t.started_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        ${filter} ${serviceFilter}
      GROUP BY 1, 2, 3, 4`,
    args,
  );
  return rows.map((r) => ({
    engagementId: r.engagement_id,
    employeeId: r.employee_id,
    day: r.day,
    serviceId: r.service_id,
    seconds: Number(r.seconds),
    billableSeconds: Number(r.billable ?? 0),
  }));
}

/**
 * Billed: issued invoice lines by issue date, less approved credit notes by
 * credit date (spread over the invoice's lines). Collected: posted receipts'
 * allocations by receipt date, ex-GST (allocation × line taxable ÷ invoice
 * total). Each on the line's engagement.
 */
async function moneyFacts(
  client: PoolClient,
  from: string,
  to: string,
  q: ProfitabilityQuery,
): Promise<MoneyFact[]> {
  const args: unknown[] = [from, to];
  const filter = engagementFilter(q, args);
  let serviceFilter = '';
  if (q.serviceId) {
    args.push(q.serviceId);
    serviceFilter = `AND ${PRIMARY_SERVICE} = $${args.length}`;
  }
  const { rows } = await client.query<{
    kind: 'billed' | 'collected';
    engagement_id: string;
    day: string;
    amount: string;
  }>(
    `WITH lines AS (
       SELECT i.id AS invoice_id, i.issue_date, i.status, i.total,
              COALESCE(li.engagement_id, i.engagement_id) AS engagement_id,
              COALESCE(li.taxable_value, li.amount) AS taxable,
              sum(COALESCE(li.taxable_value, li.amount)) OVER (PARTITION BY i.id) AS invoice_taxable
         FROM hsdg.invoices i
         JOIN hsdg.invoice_line_items li ON li.invoice_id = i.id
        WHERE i.status IN ('issued', 'partially_paid', 'paid')
     ),
     facts AS (
       SELECT 'billed' AS kind, l.engagement_id, l.issue_date AS day, l.taxable AS amount
         FROM lines l
        WHERE l.issue_date BETWEEN $1::date AND $2::date
       UNION ALL
       SELECT 'billed', l.engagement_id, cn.credit_date,
              -(cn.taxable_value * l.taxable / NULLIF(l.invoice_taxable, 0))
         FROM hsdg.credit_notes cn
         JOIN lines l ON l.invoice_id = cn.invoice_id
        WHERE cn.status = 'approved' AND cn.credit_date BETWEEN $1::date AND $2::date
       UNION ALL
       SELECT 'collected', l.engagement_id, r.received_on,
              ra.amount * l.taxable / NULLIF(l.total, 0)
         FROM hsdg.receipt_allocations ra
         JOIN hsdg.receipts r ON r.id = ra.receipt_id AND r.status = 'posted'
         JOIN lines l ON l.invoice_id = ra.invoice_id
        WHERE r.received_on BETWEEN $1::date AND $2::date
     )
     SELECT f.kind, f.engagement_id, f.day::text AS day, sum(f.amount)::text AS amount
       FROM facts f
       JOIN hsdg.engagements e ON e.id = f.engagement_id
      WHERE f.amount IS NOT NULL ${filter} ${serviceFilter}
      GROUP BY 1, 2, 3`,
    args,
  );
  return rows.map((r) => ({
    kind: r.kind,
    engagementId: r.engagement_id,
    day: r.day,
    paise: toPaise(r.amount),
  }));
}

async function engagementMeta(
  client: PoolClient,
  ids: string[],
): Promise<Map<string, EngagementMeta>> {
  if (ids.length === 0) return new Map();
  const { rows } = await client.query<{
    id: string;
    code: string;
    entity_id: string;
    entity_name: string;
    partner_id: string | null;
    partner_name: string | null;
    office_code: string | null;
    primary_service_id: string | null;
  }>(
    `SELECT e.id, e.engagement_code AS code, e.entity_id,
            COALESCE(ent.display_name, ent.legal_name) AS entity_name,
            e.engagement_partner_id AS partner_id, p.full_name AS partner_name,
            o.code AS office_code, ${PRIMARY_SERVICE} AS primary_service_id
       FROM hsdg.engagements e
       JOIN hsdg.entities ent ON ent.id = e.entity_id
       LEFT JOIN hsdg.employees p ON p.id = e.engagement_partner_id
       LEFT JOIN hsdg.offices o ON o.id = e.office_id
      WHERE e.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        code: r.code,
        entityId: r.entity_id,
        entityName: r.entity_name,
        partnerId: r.partner_id,
        partnerName: r.partner_name,
        officeCode: r.office_code,
        primaryServiceId: r.primary_service_id,
      },
    ]),
  );
}

async function rateBook(
  client: PoolClient,
  employeeIds: string[],
): Promise<{ rates: RateBook; names: Map<string, string> }> {
  const rateRow = (r: { effective_from: string; cost: string; charge: string }): RateFrom => ({
    effectiveFrom: r.effective_from,
    costPaise: toPaise(r.cost),
    chargePaise: toPaise(r.charge),
  });
  const push = (m: Map<string, RateFrom[]>, k: string, v: RateFrom) => {
    const l = m.get(k) ?? [];
    l.push(v);
    m.set(k, l);
  };
  const byGrade = new Map<string, RateFrom[]>();
  const byEmployee = new Map<string, RateFrom[]>();
  type R = { key: string; effective_from: string; cost: string; charge: string };
  const { rows: cards } = await client.query<R>(
    `SELECT grade_id AS key, effective_from::text, cost_rate_per_hour::text AS cost,
            charge_out_rate_per_hour::text AS charge
       FROM hsdg.rate_cards ORDER BY effective_from DESC`,
  );
  for (const c of cards) push(byGrade, c.key, rateRow(c));
  const { rows: own } = await client.query<R>(
    `SELECT employee_id AS key, effective_from::text, cost_rate_per_hour::text AS cost,
            charge_out_rate_per_hour::text AS charge
       FROM hsdg.employee_rates WHERE employee_id = ANY($1::uuid[])
      ORDER BY effective_from DESC`,
    [employeeIds],
  );
  for (const o of own) push(byEmployee, o.key, rateRow(o));
  const { rows: emps } = await client.query<{
    id: string;
    grade_id: string | null;
    full_name: string;
  }>(`SELECT id, grade_id, full_name FROM hsdg.employees WHERE id = ANY($1::uuid[])`, [
    employeeIds,
  ]);
  return {
    rates: { byGrade, byEmployee, gradeOf: new Map(emps.map((e) => [e.id, e.grade_id])) },
    names: new Map(emps.map((e) => [e.id, e.full_name])),
  };
}
