import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import {
  computePayLine,
  fromPaise,
  revisionArrears,
  taxYearOf,
  toPaise,
  type PayComponent,
  type PayKind,
  type PayLine,
  type PayLineItem,
  type PayMonthInput,
  type PayrollInputKind,
  type PayrollJournal,
  type PayrollRunChanges,
  type PayrollRunDetail,
  type PayrollRunLine,
  type PayrollRunStatus,
  type PayrollRunSummary,
  type PayrollRunTotals,
  type Payslip,
  type PayslipSummary,
  type StatutoryKind,
  type StatutoryWorking,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CredentialCipher } from '../credentials/credential-cipher';
import {
  assertCanSeePay,
  assertMayApprovePay,
  esiPeriodStart,
  isoDate,
  monthOf,
  monthStart,
  nextMonth,
  previousMonth,
  translatePayrollError,
} from './payroll-errors';
import { PayrollService, payAad, requireEmployee, sealedFrom } from './payroll.service';
import { renderPayslipPdf } from './payslip-pdf';
import {
  blankTaxYear,
  loadTaxYears,
  projectTds,
  taxRulesOf,
  type PersonTaxYear,
  type StoredTds,
} from './tax-context';

interface RunRow {
  id: string;
  month: string;
  kind: PayKind;
  status: PayrollRunStatus;
  people: number;
  gross: string;
  reimbursements: string;
  deductions: string;
  employer_cost: string;
  net: string;
  totals: StoredTotals;
  prepared_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  returned_reason: string | null;
  bank_reference: string | null;
  paid_at: Date | null;
  payslips_released_at: Date | null;
  version: number;
}

/** What the run header keeps: totals by head (no person), and the run's notes. */
interface StoredTotals {
  earnings?: { code: string; label: string; amount: string }[];
  deductions?: { code: string; label: string; amount: string }[];
  employer?: { code: string; label: string; amount: string }[];
  reimbursements?: string;
  warnings?: string[];
}

interface LineRow {
  id: string;
  employee_id: string;
  structure_id: string;
  month: string;
  employee_code: string;
  full_name: string;
  inputs: StoredInputs;
  line: PayLine;
  bank_changed: boolean;
  account_last4: string | null;
  net: string;
}

/** A line's inputs as computed: HR's month plus what the run worked out itself. */
interface StoredInputs extends PayMonthInput {
  autoArrears?: { structureId: string; months: string[]; amount: string };
  /** Phase 2b: how this month's TDS was projected (absent when HR entered it). */
  tds?: StoredTds;
  /** Phase 2b: the approved full and final this run pays. */
  settlement?: { id: string };
}

const RUN_SELECT = `
  SELECT r.id, r.month, r.kind, r.status, r.people, r.gross, r.reimbursements, r.deductions,
         r.employer_cost, r.net, r.totals, pu.display_name AS prepared_by,
         au.display_name AS approved_by, r.approved_at, r.returned_reason, r.bank_reference,
         r.paid_at, r.payslips_released_at, r.version
    FROM hsdg.payroll_runs r
    LEFT JOIN hsdg.users pu ON pu.id = r.prepared_by_user_id
    LEFT JOIN hsdg.users au ON au.id = r.approved_by_user_id`;

/** Statuses after the figures are fixed: what is booked, deposited and paid. */
const FINAL = ['approved', 'paid', 'locked'];

/**
 * The monthly run (spec §4.8): HR creates and computes it, submits it; the
 * Managing Partner (or the alternate) approves or returns it; HR downloads
 * the bank file, enters the bank reference once paid and releases payslips.
 * The Accountant reads totals and the journal and records statutory challans.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
    private readonly payroll: PayrollService,
  ) {}

  // ── Runs ───────────────────────────────────────────────────────────────

  async list(ctx: RlsContext): Promise<PayrollRunSummary[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const seesPay = await canSeePay(client);
      if (!seesPay && !(await isFinance(client))) {
        throw new ForbiddenException('Payroll runs are for HR, the approvers and the Accountant.');
      }
      const { rows } = await client.query<RunRow>(
        `${RUN_SELECT} ${seesPay ? '' : `WHERE r.status = ANY($1)`}
         ORDER BY r.month DESC, r.kind`,
        seesPay ? [] : [FINAL],
      );
      return rows.map(mapRun);
    });
  }

  async create(ctx: RlsContext, month: string, kind: PayKind): Promise<PayrollRunSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.payroll_runs (month, kind) VALUES ($1, $2) RETURNING id`,
          [monthStart(month), kind],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.run.created',
        objectType: 'payroll_run',
        objectId: id,
        after: { month, kind },
      });
      return mapRun(await runWith(client, id));
    });
  }

  async remove(ctx: RlsContext, id: string): Promise<void> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      try {
        const { rowCount } = await client.query(`DELETE FROM hsdg.payroll_runs WHERE id = $1`, [
          id,
        ]);
        if (rowCount === 0) throw new NotFoundException('Payroll run not found.');
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.run.deleted',
        objectType: 'payroll_run',
        objectId: id,
      });
    });
  }

  async detail(ctx: RlsContext, id: string): Promise<PayrollRunDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const run = await runWith(client, id);
      const lines = await linesWith(client, id);
      const month = monthOf(run.month);
      const prev = await client.query<{ id: string; net: string }>(
        `SELECT id, net FROM hsdg.payroll_runs WHERE month = $1 AND kind = $2`,
        [monthStart(previousMonth(month)), run.kind],
      );
      const before = prev.rows[0] ? await linesWith(client, prev.rows[0].id) : [];
      return {
        ...mapRun(run),
        warnings: run.totals.warnings ?? [],
        lines: lines.map(mapLine),
        changes: changesFrom(before, lines, prev.rows[0]?.net ?? null, run.net),
      };
    });
  }

  /**
   * Work out every line from the approved structures, HR's inputs and the
   * settings in force. Recomputing replaces the lines; a run past "computed"
   * cannot be recomputed (the trigger refuses it).
   */
  async compute(ctx: RlsContext, id: string, version: number): Promise<PayrollRunDetail> {
    await this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const run = await runWith(client, id, true);
      if (run.version !== version) throw stale();
      if (run.status !== 'draft' && run.status !== 'computed') {
        throw new ConflictException(`A ${run.status} run cannot be recomputed.`);
      }
      const month = monthOf(run.month);
      const first = monthStart(month);
      const last = lastDay(month);
      const { rules } = await this.payroll.settingsWith(client, first);

      const settlements = await client.query<{
        id: string;
        employee_id: string;
        working: { items: PayLineItem[] };
      }>(
        `SELECT id, employee_id, working FROM hsdg.exit_settlements
          WHERE status = 'approved' AND pay_month = $1`,
        [first],
      );
      const settlementOf = new Map(settlements.rows.map((x) => [x.employee_id, x]));
      const people = await client.query<{
        id: string;
        employee_code: string;
        full_name: string;
        office_code: string;
        date_of_joining: string;
        date_of_exit: string | null;
      }>(
        `SELECT e.id, e.employee_code, e.full_name, o.code AS office_code,
                e.date_of_joining, e.date_of_exit
           FROM hsdg.employees e JOIN hsdg.offices o ON o.id = e.primary_office_id
          WHERE e.date_of_joining <= $2
            AND (e.date_of_exit IS NULL OR e.date_of_exit >= $1 OR e.id = ANY ($3))
          ORDER BY e.employee_code`,
        [first, last, [...settlementOf.keys()]],
      );
      const structures = await client.query<{
        id: string;
        employee_id: string;
        effective_from: string;
        kind: PayKind;
        components: PayComponent[];
        pf_applicable: boolean;
        esi_applicable: boolean;
        pt_applicable: boolean;
      }>(
        `SELECT id, employee_id, effective_from, kind, components, pf_applicable,
                esi_applicable, pt_applicable
           FROM hsdg.salary_structures
          WHERE status = 'approved' AND effective_from <= $1
          ORDER BY employee_id, effective_from DESC`,
        [last],
      );
      const inputs = await client.query<{
        employee_id: string;
        kind: string;
        amount: string;
        note: string | null;
        source: 'hr' | 'tax' | 'bonus';
      }>(
        `SELECT employee_id, kind, amount, note, source FROM hsdg.payroll_inputs
          WHERE month = $1 AND source <> 'tax'`,
        [first],
      );
      // TDS on salary (s.392): projected afresh on every compute, unless HR entered it.
      const taxing = run.kind === 'salary';
      const taxRules = taxRulesOf(rules);
      const taxYears = taxing
        ? await loadTaxYears(client, taxYearOf(month), { beforeMonth: month, excludeRunId: id })
        : new Map<string, PersonTaxYear>();
      if (taxing) {
        try {
          await client.query(
            `DELETE FROM hsdg.payroll_inputs WHERE month = $1 AND source = 'tax'`,
            [first],
          );
        } catch (err) {
          throw translatePayrollError(err);
        }
      }
      // Lines already submitted or paid for earlier months: arrears, ESI periods.
      const earlier = await client.query<{
        employee_id: string;
        month: string;
        structure_id: string;
        components: PayComponent[];
        line: PayLine;
        inputs: StoredInputs;
      }>(
        `SELECT l.employee_id, l.month, l.structure_id, s.components, l.line, l.inputs
           FROM hsdg.payroll_lines l
           JOIN hsdg.payroll_runs r ON r.id = l.run_id
           JOIN hsdg.salary_structures s ON s.id = l.structure_id
          WHERE l.kind = $1 AND l.month < $2 AND r.status <> ALL ($3) AND r.id <> $4
          ORDER BY l.month`,
        [run.kind, first, ['draft', 'computed'], id],
      );
      const banks = await client.query<{
        employee_id: string;
        account_holder: string | null;
        ciphertext: Buffer | null;
        iv: Buffer | null;
        auth_tag: Buffer | null;
        key_version: number | null;
        account_last4: string | null;
        ifsc: string | null;
        bank_changed_at: Date | null;
        last_paid_at: Date | null;
      }>(
        `SELECT d.employee_id, d.account_holder, d.account_ciphertext AS ciphertext,
                d.account_iv AS iv, d.account_auth_tag AS auth_tag,
                d.account_key_version AS key_version, d.account_last4, d.ifsc, d.bank_changed_at,
                (SELECT max(l.paid_at) FROM hsdg.payroll_lines l
                  WHERE l.employee_id = d.employee_id) AS last_paid_at
           FROM hsdg.employee_pay_details d`,
      );
      const bankOf = new Map(banks.rows.map((b) => [b.employee_id, b]));

      await client.query(`DELETE FROM hsdg.payroll_lines WHERE run_id = $1`, [id]);

      const errors: string[] = [];
      const warnings: string[] = [];
      const sum = new Totals();
      let people_ = 0;
      const esiStart = esiPeriodStart(month);
      for (const p of people.rows) {
        const own = structures.rows.filter((s) => s.employee_id === p.id);
        const s = own.find((x) => x.kind === run.kind);
        if (!s) {
          if (own.length === 0)
            warnings.push(`${p.full_name} (${p.employee_code}) has no approved pay structure.`);
          continue;
        }
        const theirInputs = inputs.rows.filter((i) => i.employee_id === p.id);
        const lop = theirInputs.find((i) => i.kind === 'loss_of_pay_days');
        // A leaver whose full and final falls in a later month: the settlement only.
        const settlementOnly = !!p.date_of_exit && p.date_of_exit < first;
        const settlement = settlementOf.get(p.id);
        const monthInput: StoredInputs = {
          month,
          joinedOn: p.date_of_joining >= first ? p.date_of_joining : null,
          exitedOn:
            p.date_of_exit && p.date_of_exit <= last && !settlementOnly ? p.date_of_exit : null,
          lossOfPayDays: lop ? Number(lop.amount) : 0,
          inputs: theirInputs
            .filter((i) => i.kind !== 'loss_of_pay_days')
            .map((i) => ({
              kind: i.kind as PayrollInputKind,
              amount: i.amount,
              ...(i.note ? { note: i.note } : {}),
            })),
        };

        if (settlement) {
          monthInput.settlement = { id: settlement.id };
          monthInput.inputs.push(...settlementInputs(settlement.working.items));
        }

        const theirs = earlier.rows.filter((l) => l.employee_id === p.id);
        // A revision dated back into months already paid: pay the difference now, once.
        if (s.effective_from < first && !settlementOnly) {
          const covered = new Set(
            theirs.flatMap((l) =>
              l.inputs.autoArrears?.structureId === s.id ? l.inputs.autoArrears.months : [],
            ),
          );
          const owed = theirs.filter(
            (l) =>
              l.structure_id !== s.id &&
              l.month >= monthStart(monthOf(s.effective_from)) &&
              !covered.has(monthOf(l.month)),
          );
          if (owed.length > 0) {
            let total = 0n;
            for (const l of owed) {
              total += toPaise(
                revisionArrears(l.components, s.components, [
                  { month: monthOf(l.month), payableDays: l.line.payableDays },
                ]),
              );
            }
            const months = owed.map((l) => monthOf(l.month));
            monthInput.autoArrears = { structureId: s.id, months, amount: fromPaise(total) };
            if (total > 0n) {
              monthInput.inputs.push({
                kind: 'arrears',
                amount: fromPaise(total),
                note: `Revision from ${s.effective_from}`,
              });
            } else if (total < 0n) {
              monthInput.inputs.push({
                kind: 'other_deduction',
                amount: fromPaise(-total),
                note: `Revision from ${s.effective_from}`,
              });
            }
          }
        }
        if (
          s.effective_from > first &&
          own.some((x) => x.kind === run.kind && x.effective_from < s.effective_from)
        ) {
          warnings.push(
            `${p.full_name}: the revision from ${s.effective_from} is paid for the whole month; adjust with arrears if that is not intended.`,
          );
        }
        // ESI: covered at the start of the contribution period → covered to its end.
        const firstInPeriod = theirs.find((l) => monthOf(l.month) >= esiStart);
        if (firstInPeriod) {
          monthInput.esiContinuing = firstInPeriod.line.items.some(
            (i) => i.kind === 'deduction' && i.code === 'esi',
          );
        }

        const settings = {
          ...rules,
          ptSlabs: rules.ptSlabsByOffice[p.office_code] ?? rules.ptSlabs,
        };
        const structure = {
          kind: s.kind,
          ctc: '0',
          components: settlementOnly
            ? s.components.map((c) => ({ ...c, monthly: '0' }))
            : s.components,
          pfApplicable: s.pf_applicable,
          esiApplicable: s.esi_applicable,
          ptApplicable: s.pt_applicable && !settlementOnly,
        };
        let line: PayLine;
        try {
          line = computePayLine(structure, monthInput, settings);
          const ownTds = theirInputs.some((i) => i.kind === 'tds' && i.source === 'hr');
          if (taxing && !ownTds) {
            const person = taxYears.get(p.id) ?? blankTaxYear();
            const tds = projectTds({
              month,
              line,
              structure: { ...structure, components: s.components },
              settings,
              rules: taxRules,
              person,
              exitedOn: p.date_of_exit,
            });
            monthInput.tds = tds;
            if (toPaise(tds.tds) > 0n) {
              monthInput.inputs.push({ kind: 'tds', amount: tds.tds, note: 'Projected (s.392)' });
              await client.query(
                `INSERT INTO hsdg.payroll_inputs (month, employee_id, kind, amount, note, source)
                 VALUES ($1, $2, 'tds', $3, 'Projected (s.392)', 'tax')`,
                [first, p.id, tds.tds],
              );
              line = computePayLine(structure, monthInput, settings);
            }
          }
        } catch (err) {
          if (err instanceof HttpException) throw err;
          if ((err as { code?: string }).code) throw translatePayrollError(err);
          errors.push(`${p.full_name} (${p.employee_code}): ${(err as Error).message}`);
          continue;
        }
        const minimum = rules.stipendMinimumByOffice[p.office_code];
        if (s.kind === 'stipend' && minimum) {
          const monthly = s.components.reduce((t, c) => t + toPaise(c.monthly), 0n);
          if (monthly < toPaise(minimum)) {
            line.warnings.push(`Stipend is below the ICAI minimum of ${minimum} for this office.`);
          }
        }
        const bank = bankOf.get(p.id);
        if (!bank?.ciphertext && toPaise(line.net) > 0n) {
          line.warnings.push('No bank account recorded: the bank file cannot include this person.');
        }
        const bankChanged =
          !!bank?.bank_changed_at &&
          (!bank.last_paid_at || bank.bank_changed_at > bank.last_paid_at);
        if (bankChanged) line.warnings.push('Bank account changed since the last salary was paid.');

        try {
          await client.query(
            `INSERT INTO hsdg.payroll_lines
               (run_id, employee_id, structure_id, month, kind, employee_code, full_name, inputs,
                line, gross, deductions, net, employer_cost, account_holder, account_ciphertext,
                account_iv, account_auth_tag, account_key_version, account_last4, ifsc, bank_changed)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18, $19, $20, $21)`,
            [
              id,
              p.id,
              s.id,
              first,
              run.kind,
              p.employee_code,
              p.full_name,
              JSON.stringify(monthInput),
              JSON.stringify(line),
              line.gross,
              line.deductions,
              line.net,
              line.employerCost,
              bank?.account_holder ?? null,
              bank?.ciphertext ?? null,
              bank?.iv ?? null,
              bank?.auth_tag ?? null,
              bank?.key_version ?? null,
              bank?.account_last4 ?? null,
              bank?.ifsc ?? null,
              bankChanged,
            ],
          );
        } catch (err) {
          throw translatePayrollError(err);
        }
        sum.add(line);
        people_ += 1;
      }
      if (errors.length > 0) throw new BadRequestException(errors.join(' '));
      if (settlementOf.size > 0) {
        await client.query(
          `UPDATE hsdg.exit_settlements SET run_id = $1, version = version + 1
            WHERE status = 'approved' AND pay_month = $2 AND run_id IS DISTINCT FROM $1
              AND employee_id IN (SELECT employee_id FROM hsdg.payroll_lines WHERE run_id = $1)`,
          [id, first],
        );
      }

      try {
        const { rowCount } = await client.query(
          `UPDATE hsdg.payroll_runs
              SET status = 'computed', people = $2, gross = $3, reimbursements = $4,
                  deductions = $5, employer_cost = $6, net = $7, totals = $8, version = version + 1
            WHERE id = $1 AND version = $9`,
          [
            id,
            people_,
            fromPaise(sum.gross),
            fromPaise(sum.reimbursements),
            fromPaise(sum.deductions),
            fromPaise(sum.employerCost),
            fromPaise(sum.net),
            JSON.stringify({ ...sum.heads(), warnings }),
            version,
          ],
        );
        if (rowCount === 0) throw stale();
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.run.computed',
        objectType: 'payroll_run',
        objectId: id,
        after: { people: people_, net: fromPaise(sum.net) },
      });
    });
    return this.detail(ctx, id);
  }

  /** HR submits; the approver may approve or send it back with a reason. */
  async transition(
    ctx: RlsContext,
    id: string,
    version: number,
    to: 'submitted' | 'approved' | 'returned' | 'locked',
    reason?: string,
  ): Promise<PayrollRunSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (to === 'approved' || to === 'returned') await assertMayApprovePay(client);
      else await assertCanSeePay(client);
      const run = await runWith(client, id, true);
      if (run.version !== version) throw stale();
      if (to === 'submitted' && run.people === 0) {
        throw new BadRequestException('Compute the run before submitting it: it has no lines.');
      }
      if (to === 'locked' && !run.payslips_released_at) {
        throw new BadRequestException('Release the payslips before locking the run.');
      }
      try {
        await client.query(
          `UPDATE hsdg.payroll_runs
              SET status = $2, returned_reason = CASE WHEN $3::text IS NULL THEN returned_reason ELSE $3 END,
                  version = version + 1
            WHERE id = $1`,
          [id, to === 'returned' ? 'computed' : to, to === 'returned' ? (reason ?? '') : null],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: `payroll.run.${to}`,
        objectType: 'payroll_run',
        objectId: id,
        reason: reason ?? null,
      });
      return mapRun(await runWith(client, id));
    });
  }

  /**
   * The bulk-transfer file for the bank (approved runs only). The portal never
   * moves money; downloading the file is audited.
   */
  async bankFile(ctx: RlsContext, id: string): Promise<{ data: Buffer; filename: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const run = await runWith(client, id);
      if (run.status !== 'approved' && run.status !== 'paid') {
        throw new ConflictException('The bank file is available once the run is approved.');
      }
      const { rows } = await client.query<{
        employee_id: string;
        employee_code: string;
        full_name: string;
        account_holder: string | null;
        ciphertext: Buffer | null;
        iv: Buffer | null;
        auth_tag: Buffer | null;
        key_version: number | null;
        ifsc: string | null;
        net: string;
      }>(
        `SELECT employee_id, employee_code, full_name, account_holder,
                account_ciphertext AS ciphertext, account_iv AS iv, account_auth_tag AS auth_tag,
                account_key_version AS key_version, ifsc, net
           FROM hsdg.payroll_lines WHERE run_id = $1 AND net > 0 ORDER BY employee_code`,
        [id],
      );
      const missing = rows.filter((r) => !r.ciphertext || !r.ifsc).map((r) => r.full_name);
      if (missing.length > 0) {
        throw new BadRequestException(
          `No bank account for ${missing.join(', ')}. Record it, then recompute next month or pay them separately.`,
        );
      }
      const narration = `${run.kind === 'stipend' ? 'Stipend' : 'Salary'} ${monthOf(run.month)}`;
      const out = [['Beneficiary name', 'Account number', 'IFSC', 'Amount', 'Narration']];
      for (const r of rows) {
        const account = this.cipher.openText(
          sealedFrom(r)!,
          payAad('employee_pay_details', r.employee_id, 'account'),
        );
        out.push([r.account_holder ?? r.full_name, account, r.ifsc!, r.net, narration]);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.bank_file.downloaded',
        objectType: 'payroll_run',
        objectId: id,
        after: { people: rows.length, net: run.net },
      });
      return {
        data: Buffer.from(out.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8'),
        filename: `${run.kind}-${monthOf(run.month)}-bank.csv`,
      };
    });
  }

  async markPaid(
    ctx: RlsContext,
    id: string,
    version: number,
    bankReference: string,
  ): Promise<PayrollRunSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      try {
        const { rowCount } = await client.query(
          `UPDATE hsdg.payroll_runs SET status = 'paid', bank_reference = $2, version = version + 1
            WHERE id = $1 AND version = $3`,
          [id, bankReference.trim(), version],
        );
        if (rowCount === 0) throw stale();
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.run.paid',
        objectType: 'payroll_run',
        objectId: id,
        after: { bankReference: bankReference.trim() },
      });
      return mapRun(await runWith(client, id));
    });
  }

  /** Payslips become visible to each person, with the payment facts on them. */
  async release(ctx: RlsContext, id: string, version: number): Promise<PayrollRunSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      try {
        const { rowCount } = await client.query(
          `UPDATE hsdg.payroll_runs SET payslips_released_at = now(), version = version + 1
            WHERE id = $1 AND version = $2 AND status = 'paid' AND payslips_released_at IS NULL`,
          [id, version],
        );
        if (rowCount === 0) {
          throw new ConflictException('Payslips are released once, after the run is marked paid.');
        }
        await client.query(
          `UPDATE hsdg.payroll_lines l
              SET released_at = r.payslips_released_at, paid_at = r.paid_at,
                  bank_reference = r.bank_reference
             FROM hsdg.payroll_runs r
            WHERE r.id = l.run_id AND l.run_id = $1`,
          [id],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.payslips.released',
        objectType: 'payroll_run',
        objectId: id,
      });
      return mapRun(await runWith(client, id));
    });
  }

  // ── Registers and the books ────────────────────────────────────────────

  /** The pay register: one row per person, a column per head, a total row. */
  async register(ctx: RlsContext, id: string): Promise<{ data: Buffer; filename: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const run = await runWith(client, id);
      const lines = await linesWith(client, id);
      const heads = (kind: PayLineItem['kind'][]) => {
        const seen = new Map<string, string>();
        for (const l of lines) {
          for (const i of l.line.items)
            if (kind.includes(i.kind) && !seen.has(i.code)) seen.set(i.code, i.label);
        }
        return [...seen.entries()];
      };
      const earn = heads(['earning', 'reimbursement']);
      const ded = heads(['deduction']);
      const emp = heads(['employer']);
      const amountOf = (l: LineRow, kind: PayLineItem['kind'][], code: string): number =>
        Number(l.line.items.find((i) => kind.includes(i.kind) && i.code === code)?.amount ?? 0);
      const header = [
        'Code',
        'Name',
        'Days in month',
        'Payable days',
        'Loss-of-pay days',
        ...earn.map(([, l]) => l),
        'Gross',
        ...ded.map(([, l]) => l),
        'Total deductions',
        'Net pay',
        ...emp.map(([, l]) => l),
        'Cost to firm',
        'Account',
        'Bank changed',
      ];
      const body = lines.map((l) => [
        l.employee_code,
        l.full_name,
        l.line.daysInMonth,
        l.line.payableDays,
        l.line.lossOfPayDays,
        ...earn.map(([c]) => amountOf(l, ['earning', 'reimbursement'], c)),
        Number(l.line.gross),
        ...ded.map(([c]) => amountOf(l, ['deduction'], c)),
        Number(l.line.deductions),
        Number(l.line.net),
        ...emp.map(([c]) => amountOf(l, ['employer'], c)),
        Number(l.line.employerCost),
        l.account_last4 ? `••••${l.account_last4}` : '',
        l.bank_changed ? 'Yes' : '',
      ]);
      const total = header.map((_, col) =>
        col === 1
          ? 'Total'
          : col < 5 || col >= header.length - 2
            ? ''
            : body.reduce((t, r) => t + Number(r[col] ?? 0), 0),
      );
      const sheet = XLSX.utils.aoa_to_sheet([
        [
          `${run.kind === 'stipend' ? 'Stipend' : 'Salary'} register — ${monthOf(run.month)} (${run.status})`,
        ],
        [],
        header,
        ...body,
        total.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)),
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Register');
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.register.downloaded',
        objectType: 'payroll_run',
        objectId: id,
      });
      return {
        data: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
        filename: `${run.kind}-register-${monthOf(run.month)}.xlsx`,
      };
    });
  }

  /** The Accountant's "Payroll to book" feed: totals of every approved or paid run. */
  async totalsFeed(ctx: RlsContext): Promise<PayrollRunTotals[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!(await canSeePay(client)) && !(await isFinance(client))) {
        throw new ForbiddenException('Run totals are for HR, the approvers and the Accountant.');
      }
      const { rows } = await client.query<RunRow>(
        `${RUN_SELECT} WHERE r.status = ANY($1) ORDER BY r.month DESC, r.kind LIMIT 36`,
        [FINAL],
      );
      return rows.map(totalsOf);
    });
  }

  /** Totals by head — no person in them (decision 9.11). */
  async totals(ctx: RlsContext, id: string): Promise<PayrollRunTotals> {
    return this.db.withRlsContext(ctx, async (client) =>
      totalsOf(await this.runForBooks(client, id)),
    );
  }

  /** The entry to book: expense and contributions against what is payable. */
  async journal(ctx: RlsContext, id: string): Promise<PayrollJournal> {
    return this.db.withRlsContext(ctx, async (client) => {
      const run = await this.runForBooks(client, id);
      const head = (list: StoredTotals['earnings'], code: string): bigint =>
        toPaise(list?.find((h) => h.code === code)?.amount ?? '0');
      const earnings = (run.totals.earnings ?? []).reduce((t, h) => t + toPaise(h.amount), 0n);
      const d = run.totals.deductions;
      const e = run.totals.employer;
      const employerPf = head(e, 'pf_epf') + head(e, 'pf_eps');
      const employerEsi = head(e, 'esi');
      const gratuity = head(e, 'gratuity');
      const stipend = run.kind === 'stipend';
      const lines: [string, bigint, bigint][] = [
        [stipend ? 'Stipend to articled assistants' : 'Salaries and wages', earnings, 0n],
        ['Staff reimbursements', toPaise(run.reimbursements), 0n],
        ["Employer's contribution to provident fund", employerPf, 0n],
        ["Employer's contribution to ESI", employerEsi, 0n],
        ['Gratuity expense', gratuity, 0n],
        ['Provident fund payable', 0n, head(d, 'pf') + employerPf],
        ['ESI payable', 0n, head(d, 'esi') + employerEsi],
        ['Professional tax payable', 0n, head(d, 'pt')],
        ['TDS payable on salaries (section 192)', 0n, head(d, 'tds')],
        ['Staff advances', 0n, head(d, 'advance_recovery')],
        ['Other recoveries from staff', 0n, head(d, 'other')],
        ['Provision for gratuity', 0n, gratuity],
        [stipend ? 'Stipend payable' : 'Salaries payable', 0n, toPaise(run.net)],
      ];
      const entries = lines
        .filter(([, dr, cr]) => dr !== 0n || cr !== 0n)
        .map(([account, dr, cr]) => ({ account, debit: fromPaise(dr), credit: fromPaise(cr) }));
      const totalDebit = lines.reduce((t, [, dr]) => t + dr, 0n);
      const totalCredit = lines.reduce((t, [, , cr]) => t + cr, 0n);
      return {
        runId: run.id,
        month: monthOf(run.month),
        kind: run.kind,
        entries,
        totalDebit: fromPaise(totalDebit),
        totalCredit: fromPaise(totalCredit),
      };
    });
  }

  /** HR, approvers, and the Accountant for a run whose figures are fixed. */
  private async runForBooks(client: PoolClient, id: string): Promise<RunRow> {
    const seesPay = await canSeePay(client);
    if (!seesPay && !(await isFinance(client))) {
      throw new ForbiddenException('Run totals are for HR, the approvers and the Accountant.');
    }
    const run = await runWith(client, id);
    if (!seesPay && !FINAL.includes(run.status))
      throw new NotFoundException('Payroll run not found.');
    return run;
  }

  // ── Statutory deposits ─────────────────────────────────────────────────

  /** PF, ESI, PT and TDS for a month from its approved runs, with any challan recorded. */
  async statutory(ctx: RlsContext, month: string): Promise<StatutoryWorking[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!(await canSeePay(client)) && !(await isFinance(client))) {
        throw new ForbiddenException(
          'Statutory workings are for HR, the approvers and the Accountant.',
        );
      }
      const runs = await client.query<{ totals: StoredTotals; people: number }>(
        `SELECT totals, people FROM hsdg.payroll_runs WHERE month = $1 AND status = ANY($2)`,
        [monthStart(month), FINAL],
      );
      const paid = await client.query<{
        kind: StatutoryKind;
        challan_number: string;
        paid_on: string;
        paid_by: string | null;
      }>(
        `SELECT s.kind, s.challan_number, s.paid_on, u.display_name AS paid_by
           FROM hsdg.statutory_payments s LEFT JOIN hsdg.users u ON u.id = s.recorded_by_user_id
          WHERE s.month = $1`,
        [monthStart(month)],
      );
      const pick = (list: StoredTotals['earnings'], codes: string[]): bigint =>
        (list ?? [])
          .filter((h) => codes.includes(h.code))
          .reduce((t, h) => t + toPaise(h.amount), 0n);
      const count = (code: string): number =>
        runs.rows.reduce(
          (t, r) =>
            t + (((r.totals as { counts?: Record<string, number> }).counts ?? {})[code] ?? 0),
          0,
        );
      const shares: Record<StatutoryKind, [bigint, bigint, number]> = {
        pf: [0n, 0n, count('pf')],
        esi: [0n, 0n, count('esi')],
        pt: [0n, 0n, count('pt')],
        tds: [0n, 0n, count('tds')],
      };
      for (const r of runs.rows) {
        shares.pf[0] += pick(r.totals.deductions, ['pf']);
        shares.pf[1] += pick(r.totals.employer, ['pf_epf', 'pf_eps']);
        shares.esi[0] += pick(r.totals.deductions, ['esi']);
        shares.esi[1] += pick(r.totals.employer, ['esi']);
        shares.pt[0] += pick(r.totals.deductions, ['pt']);
        shares.tds[0] += pick(r.totals.deductions, ['tds']);
      }
      return (['pf', 'esi', 'pt', 'tds'] as const).map((kind) => {
        const [employee, employer, people] = shares[kind];
        const challan = paid.rows.find((p) => p.kind === kind);
        return {
          month,
          kind,
          employee: fromPaise(employee),
          employer: fromPaise(employer),
          total: fromPaise(employee + employer),
          people,
          dueOn: dueOn(kind, month),
          challanNumber: challan?.challan_number ?? null,
          paidOn: challan?.paid_on ?? null,
          paidBy: challan?.paid_by ?? null,
        };
      });
    });
  }

  /** The Accountant (or Managing Partner) records the challan once deposited. */
  async recordChallan(
    ctx: RlsContext,
    month: string,
    kind: StatutoryKind,
    input: { challanNumber: string; paidOn: string; amount: string },
  ): Promise<StatutoryWorking[]> {
    await this.db.withRlsContext(ctx, async (client) => {
      try {
        await client.query(
          `INSERT INTO hsdg.statutory_payments (month, kind, amount, challan_number, paid_on)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (month, kind) DO UPDATE SET amount = EXCLUDED.amount,
             challan_number = EXCLUDED.challan_number, paid_on = EXCLUDED.paid_on`,
          [monthStart(month), kind, input.amount, input.challanNumber.trim(), input.paidOn],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.challan.recorded',
        objectType: 'statutory_payment',
        after: { month, kind, amount: input.amount, challanNumber: input.challanNumber.trim() },
      });
    });
    return this.statutory(ctx, month);
  }

  // ── Payslips ───────────────────────────────────────────────────────────

  /** A person's released payslips (RLS shows them nothing else). */
  async ownPayslips(ctx: RlsContext): Promise<PayslipSummary[]> {
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        run_id: string;
        month: string;
        kind: PayKind;
        net: string;
        paid_at: Date | null;
      }>(
        `SELECT run_id, month, kind, net, paid_at FROM hsdg.payroll_lines
          WHERE employee_id = $1 AND released_at IS NOT NULL ORDER BY month DESC, kind`,
        [employeeId],
      );
      return rows.map((r) => ({
        runId: r.run_id,
        month: monthOf(r.month),
        kind: r.kind,
        net: r.net,
        paidAt: r.paid_at?.toISOString() ?? null,
      }));
    });
  }

  async payslip(ctx: RlsContext, runId: string, employeeId?: string): Promise<Payslip> {
    const who = employeeId ?? requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      if (employeeId) await assertCanSeePay(client);
      const row = await this.payslipRow(client, runId, who);
      return {
        runId,
        month: monthOf(row.month),
        kind: row.kind,
        displayName: row.full_name,
        employeeCode: row.employee_code,
        line: row.line,
        paidAt: row.paid_at?.toISOString() ?? null,
        bankReference: row.bank_reference,
      };
    });
  }

  async payslipPdf(
    ctx: RlsContext,
    runId: string,
    employeeId?: string,
  ): Promise<{ data: Buffer; filename: string }> {
    const who = employeeId ?? requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      if (employeeId) await assertCanSeePay(client);
      const row = await this.payslipRow(client, runId, who);
      const firm = await client.query<{ firm_name: string | null; address: string | null }>(
        `SELECT firm_name, address FROM hsdg.firm_settings LIMIT 1`,
      );
      const facts = await client.query<{ uan: string | null; office_code: string | null }>(
        `SELECT d.uan, o.code AS office_code
           FROM hsdg.employees e
           LEFT JOIN hsdg.offices o ON o.id = e.primary_office_id
           LEFT JOIN hsdg.employee_pay_details d ON d.employee_id = e.id
          WHERE e.id = $1`,
        [who],
      );
      const data = renderPayslipPdf({
        firmName: firm.rows[0]?.firm_name ?? 'The firm',
        firmAddress: firm.rows[0]?.address ?? null,
        month: monthOf(row.month),
        kind: row.kind,
        employeeCode: row.employee_code,
        fullName: row.full_name,
        officeCode: facts.rows[0]?.office_code ?? null,
        uan: facts.rows[0]?.uan ?? null,
        accountMasked: row.account_last4 ? `••••${row.account_last4}` : null,
        line: row.line,
        paidAt: row.paid_at?.toISOString() ?? null,
        bankReference: row.bank_reference,
      });
      return { data, filename: `payslip-${row.employee_code}-${monthOf(row.month)}.pdf` };
    });
  }

  private async payslipRow(
    client: PoolClient,
    runId: string,
    employeeId: string,
  ): Promise<{
    month: string;
    kind: PayKind;
    full_name: string;
    employee_code: string;
    line: PayLine;
    paid_at: Date | null;
    bank_reference: string | null;
    account_last4: string | null;
  }> {
    const { rows } = await client.query<{
      month: string;
      kind: PayKind;
      full_name: string;
      employee_code: string;
      line: PayLine;
      paid_at: Date | null;
      bank_reference: string | null;
      account_last4: string | null;
    }>(
      `SELECT month, kind, full_name, employee_code, line, paid_at, bank_reference, account_last4
         FROM hsdg.payroll_lines WHERE run_id = $1 AND employee_id = $2`,
      [runId, employeeId],
    );
    if (!rows[0]) throw new NotFoundException('No payslip for that month.');
    return rows[0];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function canSeePay(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_can_see_pay() AS ok`);
  return rows[0]?.ok === true;
}

async function isFinance(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(`SELECT hsdg.ctx_is_finance() AS ok`);
  return rows[0]?.ok === true;
}

async function runWith(client: PoolClient, id: string, lock = false): Promise<RunRow> {
  const { rows } = await client.query<RunRow>(
    `${RUN_SELECT} WHERE r.id = $1 ${lock ? 'FOR UPDATE OF r' : ''}`,
    [id],
  );
  if (!rows[0]) throw new NotFoundException('Payroll run not found.');
  return rows[0];
}

async function linesWith(client: PoolClient, runId: string): Promise<LineRow[]> {
  const { rows } = await client.query<LineRow>(
    `SELECT id, employee_id, structure_id, month, employee_code, full_name, inputs, line,
            bank_changed, account_last4, net
       FROM hsdg.payroll_lines WHERE run_id = $1 ORDER BY employee_code`,
    [runId],
  );
  return rows;
}

function mapRun(r: RunRow): PayrollRunSummary {
  return {
    id: r.id,
    month: monthOf(r.month),
    kind: r.kind,
    status: r.status,
    people: r.people,
    gross: r.gross,
    deductions: r.deductions,
    employerCost: r.employer_cost,
    net: r.net,
    preparedBy: r.prepared_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at?.toISOString() ?? null,
    returnedReason: r.returned_reason,
    bankReference: r.bank_reference,
    paidAt: r.paid_at?.toISOString() ?? null,
    payslipsReleasedAt: r.payslips_released_at?.toISOString() ?? null,
    version: r.version,
  };
}

function totalsOf(run: RunRow): PayrollRunTotals {
  return {
    id: run.id,
    month: monthOf(run.month),
    kind: run.kind,
    status: run.status,
    people: run.people,
    earnings: run.totals.earnings ?? [],
    deductions: run.totals.deductions ?? [],
    employer: run.totals.employer ?? [],
    reimbursements: run.reimbursements,
    gross: run.gross,
    net: run.net,
    bankReference: run.bank_reference,
    paidAt: run.paid_at?.toISOString() ?? null,
  };
}

function mapLine(l: LineRow): PayrollRunLine {
  return {
    ...l.line,
    id: l.id,
    employeeId: l.employee_id,
    employeeCode: l.employee_code,
    displayName: l.full_name,
    bankChanged: l.bank_changed,
  };
}

function changesFrom(
  before: LineRow[],
  now: LineRow[],
  netBefore: string | null,
  netNow: string,
): PayrollRunChanges {
  const prior = new Map(before.map((l) => [l.employee_id, l]));
  const current = new Set(now.map((l) => l.employee_id));
  return {
    joiners: now.filter((l) => !prior.has(l.employee_id)).map((l) => l.full_name),
    leavers: before.filter((l) => !current.has(l.employee_id)).map((l) => l.full_name),
    revisions: now
      .filter(
        (l) =>
          prior.has(l.employee_id) && prior.get(l.employee_id)!.structure_id !== l.structure_id,
      )
      .map((l) => l.full_name),
    lossOfPay: now.filter((l) => l.line.lossOfPayDays > 0).map((l) => l.full_name),
    bankChanged: now.filter((l) => l.bank_changed).map((l) => l.full_name),
    netChange: fromPaise(toPaise(netNow) - toPaise(netBefore ?? '0')),
  };
}

/** Sums lines into the run header and its heads (with how many people each). */
class Totals {
  gross = 0n;
  reimbursements = 0n;
  deductions = 0n;
  employerCost = 0n;
  net = 0n;
  private readonly by = new Map<
    string,
    { kind: PayLineItem['kind']; code: string; label: string; amount: bigint; people: number }
  >();

  add(line: PayLine): void {
    this.gross += toPaise(line.gross);
    this.reimbursements += toPaise(line.reimbursements);
    this.deductions += toPaise(line.deductions);
    this.employerCost += toPaise(line.employerCost);
    this.net += toPaise(line.net);
    for (const i of line.items) {
      const key = `${i.kind}:${i.code}`;
      const h = this.by.get(key) ?? {
        kind: i.kind,
        code: i.code,
        label: i.label,
        amount: 0n,
        people: 0,
      };
      h.amount += toPaise(i.amount);
      h.people += 1;
      this.by.set(key, h);
    }
  }

  heads(): StoredTotals & { counts: Record<string, number> } {
    const of = (kinds: PayLineItem['kind'][]) =>
      [...this.by.values()]
        .filter((h) => kinds.includes(h.kind))
        .map((h) => ({ code: h.code, label: h.label, amount: fromPaise(h.amount) }));
    const counts: Record<string, number> = {};
    for (const h of this.by.values()) if (h.kind === 'deduction') counts[h.code] = h.people;
    return {
      earnings: of(['earning']),
      deductions: of(['deduction']),
      employer: of(['employer']),
      reimbursements: fromPaise(this.reimbursements),
      counts,
    };
  }
}

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return isoDate(new Date(Date.UTC(y, m, 0)).toISOString())!;
}

/** PF/ESI by the 15th of the next month; TDS by the 7th (March: 30 April); PT by month end. */
export function dueOn(kind: StatutoryKind, month: string): string {
  const next = nextMonth(month);
  if (kind === 'pf' || kind === 'esi') return `${next}-15`;
  if (kind === 'tds') return month.endsWith('-03') ? `${month.slice(0, 4)}-04-30` : `${next}-07`;
  return lastDay(next);
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const stale = () =>
  new ConflictException('The run changed since you opened it. Reload and try again.');

/** An approved settlement's items as the run's inputs. */
function settlementInputs(items: PayLineItem[]): PayMonthInput['inputs'] {
  const kindOf: Record<string, PayMonthInput['inputs'][number]['kind']> = {
    leave_encashment: 'leave_encashment',
    gratuity_paid: 'gratuity',
    notice_pay: 'notice_pay',
    notice_recovery: 'notice_recovery',
  };
  return items.map((i) => ({
    kind: kindOf[i.code] ?? (i.kind === 'earning' ? 'incentive' : 'other_deduction'),
    amount: i.amount,
    note: `Full and final: ${i.label}`,
  }));
}
