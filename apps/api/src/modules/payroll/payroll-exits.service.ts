import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  computePayLine,
  daysInMonth,
  fromPaise,
  gratuityDue,
  leaveEncashmentAmount,
  noticePay,
  taxYearOf,
  toPaise,
  type ExitRow,
  type ExitSettlement,
  type ExitSettlementInput,
  type ExitStatus,
  type ExitWorking,
  type PayComponent,
  type PayKind,
  type PayLine,
  type PayLineItem,
  type PayMonthInput,
  type PayrollInputKind,
  type SalaryStructureInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  assertCanSeePay,
  assertMayApprovePay,
  isoDate,
  monthOf,
  monthStart,
  nextMonth,
  translatePayrollError,
} from './payroll-errors';
import { PayrollService, requireEmployee } from './payroll.service';
import { loadTaxYears, projectTds, taxRulesOf } from './tax-context';

interface SettlementRow {
  id: string;
  employee_id: string;
  exit_date: string;
  pay_month: string;
  status: ExitStatus;
  input: ExitSettlementInput;
  working: ExitWorking;
  prepared_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  returned_reason: string | null;
  run_id: string | null;
  run_status: string | null;
  version: number;
}

interface Leaver {
  id: string;
  employee_code: string;
  full_name: string;
  office_code: string;
  date_of_joining: string;
  date_of_exit: string | null;
}

const EMPTY_INPUT: ExitSettlementInput = {
  leaveDays: 0,
  noticeShortfallDays: 0,
  noticePayDays: 0,
  gratuityOverride: null,
  otherEarnings: [],
  otherDeductions: [],
  note: null,
};

const SETTLEMENT_SELECT = `
  SELECT x.id, x.employee_id, x.exit_date, x.pay_month, x.status, x.input, x.working,
         pu.display_name AS prepared_by, au.display_name AS approved_by, x.approved_at,
         x.returned_reason, x.run_id, r.status AS run_status, x.version
    FROM hsdg.exit_settlements x
    LEFT JOIN hsdg.users pu ON pu.id = x.prepared_by_user_id
    LEFT JOIN hsdg.users au ON au.id = x.approved_by_user_id
    LEFT JOIN hsdg.payroll_runs r ON r.id = x.run_id`;

const stale = () => new ConflictException('Someone changed this meanwhile. Reload and try again.');

/** Two working days after the last day (Code on Wages s.17(2)); weekends skipped. */
export function exitDueBy(exitDate: string): string {
  const d = new Date(`${exitDate}T00:00:00Z`);
  let left = 2;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Full and final on exit (spec §4.8): setting the exit date starts it. HR
 * prepares the last month's pay, leave encashment, gratuity when due, notice
 * pay or recovery and anything else owed either way; the Managing Partner (or
 * the alternate) approves, never the preparer; the approved settlement is
 * paid with the run of its pay month, which also deducts the TDS.
 */
@Injectable()
export class PayrollExitsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly payroll: PayrollService,
  ) {}

  async list(ctx: RlsContext): Promise<ExitRow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{
        id: string;
        employee_code: string;
        full_name: string;
        date_of_exit: string;
        status: ExitStatus | null;
        net: string | null;
        run_status: string | null;
      }>(
        `SELECT e.id, e.employee_code, e.full_name, e.date_of_exit, x.status, x.net,
                r.status AS run_status
           FROM hsdg.employees e
           LEFT JOIN hsdg.exit_settlements x
             ON x.employee_id = e.id AND x.exit_date = e.date_of_exit
           LEFT JOIN hsdg.payroll_runs r ON r.id = x.run_id
          WHERE e.date_of_exit IS NOT NULL
            AND (e.date_of_exit >= current_date - 400 OR x.status IS DISTINCT FROM 'approved')
            AND EXISTS (SELECT 1 FROM hsdg.salary_structures s
                         WHERE s.employee_id = e.id AND s.status = 'approved')
          ORDER BY e.date_of_exit DESC, e.employee_code`,
      );
      return rows.map((r) => {
        const exitDate = isoDate(r.date_of_exit)!;
        return {
          employeeId: r.id,
          employeeCode: r.employee_code,
          fullName: r.full_name,
          exitDate,
          dueBy: exitDueBy(exitDate),
          status: r.status ?? 'not_started',
          net: r.net,
          runStatus: r.run_status,
        };
      });
    });
  }

  async get(ctx: RlsContext, employeeId: string): Promise<ExitSettlement> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const leaver = await leaverWith(client, employeeId);
      const row = await settlementRow(client, leaver);
      if (row) return mapSettlement(leaver, row);
      // Not started: show what the defaults would pay.
      const w = await this.workOut(client, leaver, EMPTY_INPUT);
      return mapSettlement(leaver, null, EMPTY_INPUT, w.working, w.payMonth);
    });
  }

  /** The leaver's own statement, once approved (RLS shows nothing before). */
  async own(ctx: RlsContext): Promise<ExitSettlement | null> {
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<SettlementRow>(
        `${SETTLEMENT_SELECT} WHERE x.employee_id = $1 AND x.status = 'approved'
          ORDER BY x.exit_date DESC LIMIT 1`,
        [employeeId],
      );
      if (!rows[0]) return null;
      const { rows: e } = await client.query<Leaver>(
        `SELECT e.id, e.employee_code, e.full_name, '' AS office_code, e.date_of_joining,
                e.date_of_exit
           FROM hsdg.employees e WHERE e.id = $1`,
        [employeeId],
      );
      return mapSettlement(e[0]!, { ...rows[0], prepared_by: null, approved_by: null });
    });
  }

  async save(
    ctx: RlsContext,
    employeeId: string,
    version: number,
    input: ExitSettlementInput,
  ): Promise<ExitSettlement> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const leaver = await leaverWith(client, employeeId);
      const current = await settlementRow(client, leaver);
      if (input.gratuityOverride && !input.gratuityOverride.reason.trim()) {
        throw new BadRequestException('Say why the gratuity rule is overridden.');
      }
      const { working, payMonth } = await this.workOut(client, leaver, input);
      const values = [
        JSON.stringify(input),
        JSON.stringify(working),
        working.gross,
        working.deductions,
        working.net,
        monthStart(payMonth),
      ];
      try {
        if (!current) {
          if (version !== 0) throw stale();
          await client.query(
            `INSERT INTO hsdg.exit_settlements
               (employee_id, exit_date, input, working, gross, deductions, net, pay_month)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [employeeId, leaver.date_of_exit, ...values],
          );
        } else {
          if (current.version !== version) throw stale();
          const { rowCount } = await client.query(
            `UPDATE hsdg.exit_settlements
                SET input = $3, working = $4, gross = $5, deductions = $6, net = $7,
                    pay_month = $8, version = version + 1
              WHERE id = $1 AND version = $2`,
            [current.id, version, ...values],
          );
          if (rowCount === 0) throw stale();
        }
      } catch (err) {
        if (err instanceof ConflictException) throw err;
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.exit.saved',
        objectType: 'employee',
        objectId: employeeId,
        after: { exitDate: leaver.date_of_exit, net: working.net, payMonth },
      });
      return mapSettlement(leaver, await settlementRow(client, leaver));
    });
  }

  async transition(
    ctx: RlsContext,
    employeeId: string,
    version: number,
    to: 'submitted' | 'withdrawn' | 'approved' | 'returned',
    reason?: string,
  ): Promise<ExitSettlement> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (to === 'approved' || to === 'returned') await assertMayApprovePay(client);
      else await assertCanSeePay(client);
      const leaver = await leaverWith(client, employeeId);
      const current = await settlementRow(client, leaver);
      if (!current) throw new NotFoundException('Prepare the settlement first.');
      if (current.version !== version) throw stale();
      const status = to === 'submitted' ? 'submitted' : to === 'approved' ? 'approved' : 'draft';
      try {
        const { rowCount } = await client.query(
          `UPDATE hsdg.exit_settlements
              SET status = $3, returned_reason = $4, version = version + 1
            WHERE id = $1 AND version = $2`,
          [current.id, version, status, to === 'returned' ? (reason?.trim() ?? null) : null],
        );
        if (rowCount === 0) throw stale();
      } catch (err) {
        if (err instanceof ConflictException) throw err;
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: `payroll.exit.${to}`,
        objectType: 'employee',
        objectId: employeeId,
        after: { exitDate: leaver.date_of_exit, net: current.working.net, reason: reason ?? null },
      });
      return mapSettlement(leaver, await settlementRow(client, leaver));
    });
  }

  /** Work out the settlement: the engine's own rules, the settings in force on the exit date. */
  private async workOut(
    client: PoolClient,
    leaver: Leaver,
    input: ExitSettlementInput,
  ): Promise<{ working: ExitWorking; payMonth: string }> {
    const exitDate = isoDate(leaver.date_of_exit)!;
    const exitMonth = exitDate.slice(0, 7);
    const { rules } = await this.payroll.settingsWith(client, exitDate);
    const tax = taxRulesOf(rules);
    const settings = {
      ...rules,
      ptSlabs: rules.ptSlabsByOffice[leaver.office_code] ?? rules.ptSlabs,
    };
    const { rows: ss } = await client.query<{
      kind: PayKind;
      components: PayComponent[];
      pf_applicable: boolean;
      esi_applicable: boolean;
      pt_applicable: boolean;
    }>(
      `SELECT kind, components, pf_applicable, esi_applicable, pt_applicable
         FROM hsdg.salary_structures
        WHERE employee_id = $1 AND status = 'approved' AND effective_from <= $2
        ORDER BY effective_from DESC LIMIT 1`,
      [leaver.id, exitDate],
    );
    const s = ss[0];
    if (!s) throw new BadRequestException('This person has no approved pay structure to settle.');
    const structure: SalaryStructureInput = {
      kind: s.kind,
      ctc: '0',
      components: s.components,
      pfApplicable: s.pf_applicable,
      esiApplicable: s.esi_applicable,
      ptApplicable: s.pt_applicable,
    };
    const monthlyGross = s.components.reduce((t, c) => t + toPaise(c.monthly), 0n);
    let wages = s.components.filter((c) => c.pfWage).reduce((t, c) => t + toPaise(c.monthly), 0n);
    if (rules.labourCodeWages && wages * 2n < monthlyGross) wages = (monthlyGross + 1n) / 2n;
    const warnings: string[] = [];

    // Gratuity: the rule, unless HR overrides it with a reason.
    let gratuity: ExitWorking['gratuity'];
    if (s.kind !== 'salary') {
      gratuity = {
        eligible: false,
        countedYears: 0,
        amount: '0.00',
        reason: 'Stipend: no gratuity.',
      };
    } else {
      const g = gratuityDue({
        joinedOn: isoDate(leaver.date_of_joining)!,
        lastDay: exitDate,
        monthlyWages: fromPaise(wages),
        rules: tax,
      });
      gratuity = { ...g };
      if (input.gratuityOverride) {
        const years = Math.max(1, g.countedYears);
        const raw =
          (wages * BigInt(tax.gratuity.daysPerYear) * BigInt(years) * 2n +
            BigInt(tax.gratuity.divisor)) /
          (2n * BigInt(tax.gratuity.divisor));
        const rupees = ((raw * 2n + 100n) / 200n) * 100n;
        const cap = toPaise(tax.gratuity.cap);
        gratuity = {
          eligible: input.gratuityOverride.eligible,
          countedYears: years,
          amount: input.gratuityOverride.eligible ? fromPaise(rupees < cap ? rupees : cap) : '0.00',
          reason: `HR: ${input.gratuityOverride.reason.trim()}`,
        };
      }
    }

    const items: PayLineItem[] = [];
    const add = (kind: PayLineItem['kind'], code: string, label: string, amount: string) => {
      if (toPaise(amount) > 0n) items.push({ kind, code, label, amount });
    };
    const leaveBase = tax.leaveEncashment.basis === 'basic' ? wages : monthlyGross;
    add(
      'earning',
      'leave_encashment',
      `Leave encashment (${input.leaveDays} days)`,
      leaveEncashmentAmount({
        days: input.leaveDays,
        monthlyBase: fromPaise(leaveBase),
        rules: tax,
      }),
    );
    if (gratuity.eligible) add('earning', 'gratuity_paid', 'Gratuity', gratuity.amount);
    const dim = daysInMonth(exitMonth);
    add(
      'earning',
      'notice_pay',
      `Notice pay in lieu (${input.noticePayDays} days)`,
      noticePay({
        days: input.noticePayDays,
        monthlyGross: fromPaise(monthlyGross),
        daysInMonth: dim,
      }),
    );
    input.otherEarnings.forEach((o, i) =>
      add('earning', `other_earning_${i + 1}`, o.label, o.amount),
    );
    add(
      'deduction',
      'notice_recovery',
      `Notice not served (${input.noticeShortfallDays} days)`,
      noticePay({
        days: input.noticeShortfallDays,
        monthlyGross: fromPaise(monthlyGross),
        daysInMonth: dim,
      }),
    );
    input.otherDeductions.forEach((o, i) =>
      add('deduction', `other_deduction_${i + 1}`, o.label, o.amount),
    );

    // The pay month: the exit month's run, or the next one not yet submitted.
    const { rows: runs } = await client.query<{ month: string; status: string }>(
      `SELECT r.month, r.status FROM hsdg.payroll_runs r
        WHERE r.kind = $1 AND r.month >= $2::date AND r.status NOT IN ('draft', 'computed')`,
      [s.kind, monthStart(exitMonth)],
    );
    const closed = new Set(runs.map((r) => monthOf(r.month)));
    let payMonth = exitMonth;
    while (closed.has(payMonth)) payMonth = nextMonth(payMonth);

    // The last month's pay, as the run will compute it (unless already in a run).
    const { rows: inputs } = await client.query<{
      kind: string;
      amount: string;
      note: string | null;
    }>(
      `SELECT kind, amount, note FROM hsdg.payroll_inputs
        WHERE employee_id = $1 AND month = $2 AND source <> 'tax'`,
      [leaver.id, monthStart(exitMonth)],
    );
    const lop = inputs.find((i) => i.kind === 'loss_of_pay_days');
    const joined = isoDate(leaver.date_of_joining)!;
    const exitMonthInput: PayMonthInput = {
      month: exitMonth,
      joinedOn: joined.startsWith(exitMonth) ? joined : null,
      exitedOn: exitDate,
      lossOfPayDays: lop ? Number(lop.amount) : 0,
      inputs: inputs
        .filter((i) => i.kind !== 'loss_of_pay_days')
        .map((i) => ({
          kind: i.kind as PayrollInputKind,
          amount: i.amount,
          ...(i.note ? { note: i.note } : {}),
        })),
    };
    let lastMonth: PayLine | null = null;
    if (closed.has(exitMonth)) {
      warnings.push(
        `The ${exitMonth} run is already submitted: the settlement is paid with ${payMonth}.`,
      );
    } else {
      try {
        lastMonth = computePayLine(structure, exitMonthInput, settings);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }

    // TDS: what the pay month's run will project on salary plus the settlement.
    let tds = '0.00';
    if (s.kind === 'salary') {
      const settlementInputs = items.map((i) => ({
        kind:
          (
            {
              leave_encashment: 'leave_encashment',
              gratuity_paid: 'gratuity',
              notice_pay: 'notice_pay',
              notice_recovery: 'notice_recovery',
            } as Record<string, PayMonthInput['inputs'][number]['kind']>
          )[i.code] ?? (i.kind === 'earning' ? 'incentive' : 'other_deduction'),
        amount: i.amount,
      }));
      const together =
        payMonth === exitMonth
          ? computePayLine(
              structure,
              { ...exitMonthInput, inputs: [...exitMonthInput.inputs, ...settlementInputs] },
              settings,
            )
          : computePayLine(
              {
                ...structure,
                components: s.components.map((c) => ({ ...c, monthly: '0' })),
                ptApplicable: false,
              },
              { month: payMonth, lossOfPayDays: 0, inputs: settlementInputs },
              settings,
            );
      const person = (
        await loadTaxYears(client, taxYearOf(payMonth), {
          employeeIds: [leaver.id],
          beforeMonth: payMonth,
        })
      ).get(leaver.id);
      if (person) {
        tds = projectTds({
          month: payMonth,
          line: together,
          structure,
          settings,
          rules: tax,
          person,
          exitedOn: exitDate,
        }).tds;
      }
    }

    const sum = (kind: PayLineItem['kind']) =>
      items.filter((i) => i.kind === kind).reduce((t, i) => t + toPaise(i.amount), 0n);
    const gross = sum('earning');
    const deductions = sum('deduction');
    if (!gratuity.eligible && s.kind === 'salary') warnings.push(`No gratuity: ${gratuity.reason}`);
    const due = exitDueBy(exitDate);
    if (new Date().toISOString().slice(0, 10) > due) {
      warnings.push(`Wages due on exit were to be paid by ${due} (Code on Wages).`);
    }
    if (gross - deductions < 0n) warnings.push('Recoveries are more than the settlement pays.');
    return {
      payMonth,
      working: {
        lastMonth,
        gratuity,
        items,
        tds,
        gross: fromPaise(gross),
        deductions: fromPaise(deductions),
        net: fromPaise(gross - deductions),
        warnings,
      },
    };
  }
}

async function leaverWith(client: PoolClient, employeeId: string): Promise<Leaver> {
  const { rows } = await client.query<Leaver>(
    `SELECT e.id, e.employee_code, e.full_name, o.code AS office_code, e.date_of_joining,
            e.date_of_exit
       FROM hsdg.employees e JOIN hsdg.offices o ON o.id = e.primary_office_id
      WHERE e.id = $1`,
    [employeeId],
  );
  const e = rows[0];
  if (!e) throw new NotFoundException('Employee not found.');
  if (!e.date_of_exit) {
    throw new BadRequestException(
      'Set the exit date on the person first; the settlement follows it.',
    );
  }
  return e;
}

async function settlementRow(client: PoolClient, leaver: Leaver): Promise<SettlementRow | null> {
  const { rows } = await client.query<SettlementRow>(
    `${SETTLEMENT_SELECT} WHERE x.employee_id = $1 AND x.exit_date = $2`,
    [leaver.id, leaver.date_of_exit],
  );
  return rows[0] ?? null;
}

function mapSettlement(
  leaver: Leaver,
  row: SettlementRow | null,
  input: ExitSettlementInput = EMPTY_INPUT,
  working: ExitWorking | null = null,
  payMonth?: string,
): ExitSettlement {
  const exitDate = isoDate(row?.exit_date ?? leaver.date_of_exit)!;
  return {
    id: row?.id ?? null,
    employeeId: leaver.id,
    employeeCode: leaver.employee_code,
    fullName: leaver.full_name,
    joinedOn: isoDate(leaver.date_of_joining)!,
    exitDate,
    dueBy: exitDueBy(exitDate),
    payMonth: row ? monthOf(row.pay_month) : (payMonth ?? exitDate.slice(0, 7)),
    status: row?.status ?? 'not_started',
    input: row?.input ?? input,
    working: row?.working ?? working,
    preparedBy: row?.prepared_by ?? null,
    approvedBy: row?.approved_by ?? null,
    approvedAt: row?.approved_at?.toISOString() ?? null,
    returnedReason: row?.returned_reason ?? null,
    runId: row?.run_id ?? null,
    runStatus: row?.run_status ?? null,
    version: row?.version ?? 0,
  };
}
