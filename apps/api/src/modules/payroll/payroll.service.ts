import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DEFAULT_PAY_SETTINGS,
  DEFAULT_TAX_RULES,
  maskTail,
  stipendBelowMinimum,
  type BankChangeRequest,
  type EmployeePayDetails,
  type PayComponent,
  type PayRosterRow,
  type PayRules,
  type PaySettingsRecord,
  type PayrollInputKind,
  type PayrollMonthInputs,
  type ProposeStructureInput,
  type PtSlab,
  type SalaryStructure,
  type SetPayDetailsInput,
  type TaxRules,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CredentialCipher, type SealedCredential } from '../credentials/credential-cipher';
import {
  assertCanSeePay,
  assertMayApprovePay,
  isoDate,
  monthStart,
  translatePayrollError,
} from './payroll-errors';

interface StructureRow {
  id: string;
  employee_id: string;
  effective_from: string;
  kind: 'salary' | 'stipend';
  ctc: string;
  components: PayComponent[];
  pf_applicable: boolean;
  esi_applicable: boolean;
  pt_applicable: boolean;
  status: SalaryStructure['status'];
  note: string | null;
  proposed_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  version: number;
  office_code: string | null;
  full_name?: string;
  employee_code?: string;
}

const STRUCTURE_SELECT = `
  SELECT s.id, s.employee_id, s.effective_from, s.kind, s.ctc, s.components,
         s.pf_applicable, s.esi_applicable, s.pt_applicable, s.status, s.note,
         pu.display_name AS proposed_by, au.display_name AS approved_by, s.approved_at,
         s.version, o.code AS office_code, e.full_name, e.employee_code
    FROM hsdg.salary_structures s
    JOIN hsdg.employees e ON e.id = s.employee_id
    LEFT JOIN hsdg.offices o ON o.id = e.primary_office_id
    LEFT JOIN hsdg.users pu ON pu.id = s.proposed_by_user_id
    LEFT JOIN hsdg.users au ON au.id = s.approved_by_user_id`;

/** Bind a sealed number to its row and field, so it can't be moved to another. */
export const payAad = (table: string, id: string, field: string): string =>
  `${table}|${id}|${field}`;

export function sealedFrom(row: {
  ciphertext: Buffer | null;
  iv: Buffer | null;
  auth_tag: Buffer | null;
  key_version: number | null;
}): SealedCredential | null {
  if (!row.ciphertext || !row.iv || !row.auth_tag || row.key_version === null) return null;
  return {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
  };
}

/**
 * Payroll set-up and self-service (spec §4.8, §7.6): statutory settings, the
 * approvers, salary structures (HR proposes, the Managing Partner approves),
 * bank and statutory numbers (sealed; a reveal is audited), bank-change
 * requests, the month's inputs, and what each person sees of their own pay.
 * The monthly run lives in PayrollRunsService.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
  ) {}

  // ── Settings ───────────────────────────────────────────────────────────

  /** The rules in force on a date (default: today). */
  async settings(ctx: RlsContext, onDate?: string): Promise<PaySettingsRecord> {
    return this.db.withRlsContext(ctx, (client) => this.settingsWith(client, onDate));
  }

  async settingsWith(client: PoolClient, onDate?: string): Promise<PaySettingsRecord> {
    const { rows } = await client.query<{
      effective_from: string;
      rules: Partial<PayRules>;
      confirmed_by: string | null;
    }>(
      `SELECT s.effective_from, s.rules, u.display_name AS confirmed_by
         FROM hsdg.pay_settings s LEFT JOIN hsdg.users u ON u.id = s.confirmed_by_user_id
        WHERE s.effective_from <= COALESCE($1::date, current_date)
        ORDER BY s.effective_from DESC LIMIT 1`,
      [onDate ?? null],
    );
    const r = rows[0];
    const rules: PayRules = {
      ...DEFAULT_PAY_SETTINGS,
      ptSlabsByOffice: {},
      stipendMinimumByOffice: {},
      ...(r?.rules ?? {}),
    };
    return {
      effectiveFrom: r?.effective_from ?? '2026-04-01',
      rules,
      confirmedBy: r?.confirmed_by ?? null,
    };
  }

  async saveSettings(
    ctx: RlsContext,
    effectiveFrom: string,
    rules: Record<string, unknown>,
  ): Promise<PaySettingsRecord> {
    const merged = validateRules(rules);
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      try {
        await client.query(
          `INSERT INTO hsdg.pay_settings (effective_from, rules, confirmed_by_user_id)
           VALUES ($1, $2, $3)`,
          [effectiveFrom, JSON.stringify(merged), ctx.userId],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.settings.saved',
        objectType: 'pay_settings',
        after: { effectiveFrom },
      });
      return this.settingsWith(client, effectiveFrom);
    });
  }

  // ── Approvers ──────────────────────────────────────────────────────────

  async approvers(ctx: RlsContext): Promise<{ userId: string; displayName: string }[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{ user_id: string; display_name: string }>(
        `SELECT a.user_id, u.display_name FROM hsdg.payroll_approvers a
           JOIN hsdg.users u ON u.id = a.user_id ORDER BY u.display_name`,
      );
      return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name }));
    });
  }

  /** The Managing Partner names the one alternate (decision 9.10). */
  async setAlternate(ctx: RlsContext, userId: string | null): Promise<void> {
    return this.db.withRlsContext(ctx, async (client) => {
      try {
        await client.query(`DELETE FROM hsdg.payroll_approvers`);
        if (userId) {
          await client.query(
            `INSERT INTO hsdg.payroll_approvers (user_id, added_by_user_id) VALUES ($1, $2)`,
            [userId, ctx.userId],
          );
        }
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.alternate_approver.set',
        objectType: 'payroll_approvers',
        objectId: userId,
      });
    });
  }

  // ── Roster and structures ──────────────────────────────────────────────

  /** Everyone on the rolls with their current pay — the structures page. */
  async roster(ctx: RlsContext): Promise<PayRosterRow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const people = await client.query<{
        id: string;
        employee_code: string;
        full_name: string;
        office_code: string;
        grade: string | null;
        employment_status: string;
        date_of_joining: string;
        date_of_exit: string | null;
        has_bank: boolean;
        open_change: boolean;
      }>(
        `SELECT e.id, e.employee_code, e.full_name, o.code AS office_code, g.name AS grade,
                e.employment_status, e.date_of_joining, e.date_of_exit,
                (d.account_ciphertext IS NOT NULL) AS has_bank,
                EXISTS (SELECT 1 FROM hsdg.bank_change_requests b
                         WHERE b.employee_id = e.id AND b.status = 'requested') AS open_change
           FROM hsdg.employees e
           JOIN hsdg.offices o ON o.id = e.primary_office_id
           LEFT JOIN hsdg.grades g ON g.id = e.grade_id
           LEFT JOIN hsdg.employee_pay_details d ON d.employee_id = e.id
          WHERE e.employment_status <> 'exited'
             OR e.date_of_exit >= current_date - interval '120 days'
          ORDER BY e.full_name`,
      );
      const structures = await client.query<StructureRow>(
        `${STRUCTURE_SELECT} ORDER BY s.employee_id, s.effective_from DESC`,
      );
      const minimum = (await this.settingsWith(client)).rules.stipendMinimumByOffice;
      const today = isoDate(new Date())!;
      return people.rows.map((p) => {
        const own = structures.rows.filter((s) => s.employee_id === p.id);
        const current =
          own.find((s) => s.status === 'approved' && s.effective_from <= today) ??
          own.find((s) => s.status === 'approved') ??
          null;
        return {
          employeeId: p.id,
          employeeCode: p.employee_code,
          fullName: p.full_name,
          officeCode: p.office_code,
          grade: p.grade,
          status: p.employment_status,
          dateOfJoining: p.date_of_joining,
          dateOfExit: p.date_of_exit,
          current: current ? mapStructure(current, minimum) : null,
          pending: own.filter((s) => s.status === 'proposed').length,
          hasBankAccount: p.has_bank,
          openBankChange: p.open_change,
        };
      });
    });
  }

  async structures(
    ctx: RlsContext,
    filter: { employeeId?: string; status?: string },
  ): Promise<SalaryStructure[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const conds: string[] = [];
      const params: unknown[] = [];
      if (filter.employeeId) {
        params.push(filter.employeeId);
        conds.push(`s.employee_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        conds.push(`s.status = $${params.length}`);
      }
      const { rows } = await client.query<StructureRow>(
        `${STRUCTURE_SELECT} ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
         ORDER BY s.effective_from DESC, e.full_name`,
        params,
      );
      const minimum = (await this.settingsWith(client)).rules.stipendMinimumByOffice;
      return rows.map((r) => mapStructure(r, minimum));
    });
  }

  async propose(ctx: RlsContext, input: ProposeStructureInput): Promise<SalaryStructure> {
    assertComponents(input.components);
    return this.db.withRlsContext(ctx, async (client) => {
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.salary_structures
             (employee_id, effective_from, kind, ctc, components, pf_applicable,
              esi_applicable, pt_applicable, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            input.employeeId,
            input.effectiveFrom,
            input.kind,
            input.ctc,
            JSON.stringify(input.components),
            input.pfApplicable,
            input.esiApplicable,
            input.ptApplicable,
            input.note ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.structure.proposed',
        objectType: 'salary_structure',
        objectId: id,
        after: { employeeId: input.employeeId, effectiveFrom: input.effectiveFrom },
      });
      return this.structureWith(client, id);
    });
  }

  /** The Managing Partner (or alternate) approves or rejects — never the proposer. */
  async decideStructure(
    ctx: RlsContext,
    id: string,
    decision: 'approve' | 'reject',
    note?: string,
  ): Promise<SalaryStructure> {
    if (decision === 'reject' && !note?.trim()) {
      throw new BadRequestException('Say why the structure is rejected.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertMayApprovePay(client);
      try {
        const { rowCount } = await client.query(
          `UPDATE hsdg.salary_structures
              SET status = $2, decision_note = $3, version = version + 1
            WHERE id = $1 AND status = 'proposed'`,
          [id, decision === 'approve' ? 'approved' : 'rejected', note ?? null],
        );
        if (rowCount === 0) throw new ConflictException('This structure is no longer waiting.');
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: `payroll.structure.${decision === 'approve' ? 'approved' : 'rejected'}`,
        objectType: 'salary_structure',
        objectId: id,
        reason: note ?? null,
      });
      return this.structureWith(client, id);
    });
  }

  private async structureWith(client: PoolClient, id: string): Promise<SalaryStructure> {
    const { rows } = await client.query<StructureRow>(`${STRUCTURE_SELECT} WHERE s.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Salary structure not found.');
    const minimum = (await this.settingsWith(client)).rules.stipendMinimumByOffice;
    return mapStructure(rows[0], minimum);
  }

  // ── Bank and statutory numbers ─────────────────────────────────────────

  async payDetails(ctx: RlsContext, employeeId: string): Promise<EmployeePayDetails> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (employeeId !== ctx.employeeId) await assertCanSeePay(client);
      return this.payDetailsWith(client, employeeId);
    });
  }

  private async payDetailsWith(
    client: PoolClient,
    employeeId: string,
  ): Promise<EmployeePayDetails> {
    const { rows } = await client.query<{
      account_holder: string | null;
      account_last4: string | null;
      ifsc: string | null;
      bank_name: string | null;
      pan_last4: string | null;
      uan: string | null;
      esi_number: string | null;
      aadhaar_last4: string | null;
      updated_at: Date | null;
    }>(
      `SELECT account_holder, account_last4, ifsc, bank_name, pan_last4, uan, esi_number,
              aadhaar_last4, updated_at
         FROM hsdg.employee_pay_details WHERE employee_id = $1`,
      [employeeId],
    );
    const r = rows[0];
    return {
      employeeId,
      accountHolder: r?.account_holder ?? null,
      accountMasked: r?.account_last4 ? maskTail(`00000000${r.account_last4}`) : null,
      ifsc: r?.ifsc ?? null,
      bankName: r?.bank_name ?? null,
      panMasked: r?.pan_last4 ? maskTail(`000000${r.pan_last4}`) : null,
      uan: r?.uan ?? null,
      esiNumber: r?.esi_number ?? null,
      aadhaarLast4: r?.aadhaar_last4 ?? null,
      updatedAt: r?.updated_at?.toISOString() ?? null,
    };
  }

  /** HR sets the numbers. A changed account is flagged on the next run for the approver. */
  async setPayDetails(
    ctx: RlsContext,
    employeeId: string,
    input: SetPayDetailsInput,
  ): Promise<EmployeePayDetails> {
    this.requireCipher();
    return this.db.withRlsContext(ctx, async (client) => {
      await this.writeAccount(client, ctx, employeeId, {
        accountHolder: input.accountHolder,
        accountNumber: input.accountNumber,
        ifsc: input.ifsc,
        bankName: input.bankName ?? null,
      });
      const pan = input.pan
        ? this.cipher.sealText(input.pan, payAad('employee_pay_details', employeeId, 'pan'))
        : null;
      try {
        await client.query(
          `UPDATE hsdg.employee_pay_details
              SET pan_ciphertext = COALESCE($2, pan_ciphertext), pan_iv = COALESCE($3, pan_iv),
                  pan_auth_tag = COALESCE($4, pan_auth_tag),
                  pan_key_version = COALESCE($5, pan_key_version),
                  pan_last4 = COALESCE($6, pan_last4),
                  uan = COALESCE($7, uan), esi_number = COALESCE($8, esi_number),
                  aadhaar_last4 = COALESCE($9, aadhaar_last4)
            WHERE employee_id = $1`,
          [
            employeeId,
            pan?.ciphertext ?? null,
            pan?.iv ?? null,
            pan?.authTag ?? null,
            pan?.keyVersion ?? null,
            input.pan ? input.pan.slice(-4) : null,
            input.uan ?? null,
            input.esiNumber ?? null,
            input.aadhaarLast4 ?? null,
          ],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.pay_details.set',
        objectType: 'employee_pay_details',
        objectId: employeeId,
        after: { ifsc: input.ifsc, accountLast4: input.accountNumber.slice(-4) },
      });
      return this.payDetailsWith(client, employeeId);
    });
  }

  private async writeAccount(
    client: PoolClient,
    ctx: RlsContext,
    employeeId: string,
    a: { accountHolder: string; accountNumber: string; ifsc: string; bankName: string | null },
  ): Promise<void> {
    const sealed = this.cipher.sealText(
      a.accountNumber,
      payAad('employee_pay_details', employeeId, 'account'),
    );
    const before = await client.query<{ account_last4: string | null; ifsc: string | null }>(
      `SELECT account_last4, ifsc FROM hsdg.employee_pay_details WHERE employee_id = $1`,
      [employeeId],
    );
    const prior = before.rows[0];
    const changed =
      !!prior?.account_last4 &&
      (prior.account_last4 !== a.accountNumber.slice(-4) || prior.ifsc !== a.ifsc);
    try {
      await client.query(
        `INSERT INTO hsdg.employee_pay_details
           (employee_id, account_holder, account_ciphertext, account_iv, account_auth_tag,
            account_key_version, account_last4, ifsc, bank_name, updated_by_user_id, bank_changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $11 THEN now() END)
         ON CONFLICT (employee_id) DO UPDATE SET
           account_holder = EXCLUDED.account_holder,
           account_ciphertext = EXCLUDED.account_ciphertext, account_iv = EXCLUDED.account_iv,
           account_auth_tag = EXCLUDED.account_auth_tag,
           account_key_version = EXCLUDED.account_key_version,
           account_last4 = EXCLUDED.account_last4, ifsc = EXCLUDED.ifsc,
           bank_name = EXCLUDED.bank_name, updated_by_user_id = EXCLUDED.updated_by_user_id,
           bank_changed_at = CASE WHEN $11 THEN now() ELSE hsdg.employee_pay_details.bank_changed_at END,
           version = hsdg.employee_pay_details.version + 1`,
        [
          employeeId,
          a.accountHolder,
          sealed.ciphertext,
          sealed.iv,
          sealed.authTag,
          sealed.keyVersion,
          a.accountNumber.slice(-4),
          a.ifsc,
          a.bankName,
          ctx.userId,
          changed,
        ],
      );
    } catch (err) {
      throw translatePayrollError(err);
    }
  }

  /** Show a full number — HR or an approver only, and every reveal is audited. */
  async reveal(
    ctx: RlsContext,
    employeeId: string,
    field: 'account' | 'pan',
  ): Promise<{ value: string }> {
    this.requireCipher();
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{
        ciphertext: Buffer | null;
        iv: Buffer | null;
        auth_tag: Buffer | null;
        key_version: number | null;
      }>(
        field === 'account'
          ? `SELECT account_ciphertext AS ciphertext, account_iv AS iv, account_auth_tag AS auth_tag,
                    account_key_version AS key_version
               FROM hsdg.employee_pay_details WHERE employee_id = $1`
          : `SELECT pan_ciphertext AS ciphertext, pan_iv AS iv, pan_auth_tag AS auth_tag,
                    pan_key_version AS key_version
               FROM hsdg.employee_pay_details WHERE employee_id = $1`,
        [employeeId],
      );
      const sealed = rows[0] ? sealedFrom(rows[0]) : null;
      if (!sealed) throw new NotFoundException('Nothing recorded.');
      const value = this.cipher.openText(sealed, payAad('employee_pay_details', employeeId, field));
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.pay_details.revealed',
        objectType: 'employee_pay_details',
        objectId: employeeId,
        after: { field },
      });
      return { value };
    });
  }

  // ── Bank-change requests ───────────────────────────────────────────────

  /** A person asks to be paid into another account; HR verifies before the next run. */
  async requestBankChange(
    ctx: RlsContext,
    input: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string },
  ): Promise<BankChangeRequest> {
    this.requireCipher();
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const id = randomUUID();
      const sealed = this.cipher.sealText(
        input.accountNumber,
        payAad('bank_change_requests', id, 'account'),
      );
      try {
        await client.query(
          `INSERT INTO hsdg.bank_change_requests
             (id, employee_id, account_holder, account_ciphertext, account_iv, account_auth_tag,
              account_key_version, account_last4, ifsc, bank_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            employeeId,
            input.accountHolder,
            sealed.ciphertext,
            sealed.iv,
            sealed.authTag,
            sealed.keyVersion,
            input.accountNumber.slice(-4),
            input.ifsc,
            input.bankName ?? null,
          ],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      // Redirecting salary is the commonest payroll fraud: it is on the record
      // and HR must verify it with the person before it reaches a bank file.
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.bank_change.requested',
        objectType: 'bank_change_request',
        objectId: id,
        after: { employeeId, ifsc: input.ifsc, accountLast4: input.accountNumber.slice(-4) },
      });
      return (await this.bankChangesWith(client, { id }))[0]!;
    });
  }

  async bankChanges(ctx: RlsContext, status?: string): Promise<BankChangeRequest[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      return this.bankChangesWith(client, { status });
    });
  }

  async ownBankChanges(ctx: RlsContext): Promise<BankChangeRequest[]> {
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, (client) => this.bankChangesWith(client, { employeeId }));
  }

  private async bankChangesWith(
    client: PoolClient,
    f: { id?: string; status?: string; employeeId?: string },
  ): Promise<BankChangeRequest[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    for (const [col, v] of [
      ['b.id', f.id],
      ['b.status', f.status],
      ['b.employee_id', f.employeeId],
    ] as const) {
      if (v) {
        params.push(v);
        conds.push(`${col} = $${params.length}`);
      }
    }
    const { rows } = await client.query<{
      id: string;
      employee_id: string;
      full_name: string | null;
      account_holder: string;
      account_last4: string;
      ifsc: string;
      status: BankChangeRequest['status'];
      created_at: Date;
      decided_by: string | null;
      decided_at: Date | null;
      reason: string | null;
    }>(
      `SELECT b.id, b.employee_id, e.full_name, b.account_holder, b.account_last4, b.ifsc,
              b.status, b.created_at, u.display_name AS decided_by, b.decided_at, b.reason
         FROM hsdg.bank_change_requests b
         LEFT JOIN hsdg.employees e ON e.id = b.employee_id
         LEFT JOIN hsdg.users u ON u.id = b.decided_by_user_id
        ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY b.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      displayName: r.full_name ?? '',
      accountHolder: r.account_holder,
      accountMasked: maskTail(`00000000${r.account_last4}`),
      ifsc: r.ifsc,
      status: r.status,
      requestedAt: r.created_at.toISOString(),
      verifiedBy: r.decided_by,
      verifiedAt: r.decided_at?.toISOString() ?? null,
      reason: r.reason,
    }));
  }

  /** HR verifies (with the person, on their old details) or rejects a change. */
  async decideBankChange(
    ctx: RlsContext,
    id: string,
    decision: 'verify' | 'reject',
    reason?: string,
  ): Promise<BankChangeRequest> {
    this.requireCipher();
    if (decision === 'reject' && !reason?.trim()) {
      throw new BadRequestException('Say why the change is rejected.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        employee_id: string;
        account_holder: string;
        ifsc: string;
        bank_name: string | null;
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
        key_version: number;
      }>(
        `SELECT employee_id, account_holder, ifsc, bank_name, account_ciphertext AS ciphertext,
                account_iv AS iv, account_auth_tag AS auth_tag, account_key_version AS key_version
           FROM hsdg.bank_change_requests WHERE id = $1 AND status = 'requested' FOR UPDATE`,
        [id],
      );
      const req = rows[0];
      if (!req) throw new NotFoundException('No bank change waiting with that id.');
      try {
        await client.query(
          `UPDATE hsdg.bank_change_requests SET status = $2, reason = $3 WHERE id = $1`,
          [id, decision === 'verify' ? 'verified' : 'rejected', reason ?? null],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      if (decision === 'verify') {
        const account = this.cipher.openText(
          sealedFrom(req)!,
          payAad('bank_change_requests', id, 'account'),
        );
        await this.writeAccount(client, ctx, req.employee_id, {
          accountHolder: req.account_holder,
          accountNumber: account,
          ifsc: req.ifsc,
          bankName: req.bank_name,
        });
        // A verified change always counts as a change, even for a first account.
        await client.query(
          `UPDATE hsdg.employee_pay_details SET bank_changed_at = now() WHERE employee_id = $1`,
          [req.employee_id],
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: `payroll.bank_change.${decision === 'verify' ? 'verified' : 'rejected'}`,
        objectType: 'bank_change_request',
        objectId: id,
        reason: reason ?? null,
      });
      return (await this.bankChangesWith(client, { id }))[0]!;
    });
  }

  // ── Monthly inputs ─────────────────────────────────────────────────────

  async inputs(ctx: RlsContext, month: string): Promise<PayrollMonthInputs[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{
        employee_id: string;
        kind: PayrollInputKind | 'loss_of_pay_days';
        amount: string;
        note: string | null;
        source: 'hr' | 'tax' | 'bonus';
      }>(
        `SELECT employee_id, kind, amount, note, source FROM hsdg.payroll_inputs
          WHERE month = $1 ORDER BY employee_id, kind, created_at`,
        [monthStart(month)],
      );
      const by = new Map<string, PayrollMonthInputs>();
      for (const r of rows) {
        const e = by.get(r.employee_id) ?? {
          employeeId: r.employee_id,
          lossOfPayDays: 0,
          inputs: [],
        };
        if (r.source !== 'hr' && r.kind !== 'loss_of_pay_days') {
          (e.auto ??= []).push({ kind: r.kind, amount: r.amount, note: r.note, source: r.source });
        } else if (r.kind === 'loss_of_pay_days') e.lossOfPayDays = Number(r.amount);
        else e.inputs.push({ kind: r.kind, amount: r.amount, note: r.note });
        by.set(r.employee_id, e);
      }
      return [...by.values()];
    });
  }

  /**
   * Replace one person's inputs for the month (refused once their run is
   * submitted). Only HR's own: projected TDS and bonus rows stay.
   */
  async setInputs(
    ctx: RlsContext,
    month: string,
    employeeId: string,
    lossOfPayDays: number,
    inputs: { kind: string; amount: string; note?: string }[],
  ): Promise<void> {
    return this.db.withRlsContext(ctx, async (client) => {
      try {
        await client.query(
          `DELETE FROM hsdg.payroll_inputs WHERE month = $1 AND employee_id = $2 AND source = 'hr'`,
          [monthStart(month), employeeId],
        );
        const all = [
          ...(lossOfPayDays > 0
            ? [{ kind: 'loss_of_pay_days', amount: String(lossOfPayDays), note: undefined }]
            : []),
          ...inputs,
        ];
        for (const i of all) {
          await client.query(
            `INSERT INTO hsdg.payroll_inputs (month, employee_id, kind, amount, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [monthStart(month), employeeId, i.kind, i.amount, i.note ?? null],
          );
        }
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.inputs.set',
        objectType: 'payroll_inputs',
        objectId: employeeId,
        after: { month, lossOfPayDays, count: inputs.length },
      });
    });
  }

  // ── Self-service ───────────────────────────────────────────────────────

  /** A person's own pay: approved structures, numbers (masked) and open bank change. */
  async own(ctx: RlsContext): Promise<{
    structures: SalaryStructure[];
    payDetails: EmployeePayDetails;
    bankChanges: BankChangeRequest[];
  }> {
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<StructureRow>(
        `SELECT s.id, s.employee_id, s.effective_from, s.kind, s.ctc, s.components,
                s.pf_applicable, s.esi_applicable, s.pt_applicable, s.status, s.note,
                NULL::text AS proposed_by, NULL::text AS approved_by, s.approved_at, s.version,
                NULL::text AS office_code
           FROM hsdg.salary_structures s
          WHERE s.employee_id = $1 AND s.status = 'approved'
          ORDER BY s.effective_from DESC`,
        [employeeId],
      );
      return {
        structures: rows.map((r) => mapStructure(r, {})),
        payDetails: await this.payDetailsWith(client, employeeId),
        bankChanges: await this.bankChangesWith(client, { employeeId }),
      };
    });
  }

  private requireCipher(): void {
    if (!this.cipher.ready) {
      throw new ServiceUnavailableException(
        'Bank details cannot be saved until the encryption key is configured.',
      );
    }
  }
}

export function requireEmployee(ctx: RlsContext): string {
  if (!ctx.employeeId)
    throw new NotFoundException('Your login is not linked to an employee record.');
  return ctx.employeeId;
}

function mapStructure(r: StructureRow, stipendMinimum: Record<string, string>): SalaryStructure {
  const monthly = r.components.reduce((s, c) => s + Number(c.monthly), 0);
  const minimum = r.office_code ? stipendMinimum[r.office_code] : undefined;
  return {
    id: r.id,
    employeeId: r.employee_id,
    effectiveFrom: r.effective_from,
    kind: r.kind,
    ctc: r.ctc,
    components: r.components,
    pfApplicable: r.pf_applicable,
    esiApplicable: r.esi_applicable,
    ptApplicable: r.pt_applicable,
    status: r.status,
    proposedBy: r.proposed_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at?.toISOString() ?? null,
    note: r.note,
    belowStipendMinimum:
      r.kind === 'stipend' && minimum !== undefined
        ? stipendBelowMinimum(monthly.toFixed(2), minimum)
        : false,
    ...(r.full_name ? { fullName: r.full_name, employeeCode: r.employee_code } : {}),
    version: r.version,
  };
}

function assertComponents(components: PayComponent[]): void {
  const codes = new Set<string>();
  for (const c of components) {
    if (codes.has(c.code)) throw new BadRequestException(`Component ${c.code} is listed twice.`);
    codes.add(c.code);
  }
}

/** Keep only what the engine reads; refuse an unknown shape early. */
function validateRules(raw: Record<string, unknown>): PayRules {
  const r = {
    ...DEFAULT_PAY_SETTINGS,
    ptSlabsByOffice: {},
    stipendMinimumByOffice: {},
    ...raw,
  } as PayRules;
  const isRate = (v: unknown) => typeof v === 'string' && /^\d{1,3}(\.\d{1,2})?$/.test(v);
  const isAmount = (v: unknown) => typeof v === 'string' && /^\d{1,12}(\.\d{1,2})?$/.test(v);
  const slabsOk = (slabs: unknown) =>
    Array.isArray(slabs) &&
    slabs.every(
      (s: PtSlab) =>
        isAmount(s.from) &&
        (s.to === null || isAmount(s.to)) &&
        isAmount(s.amount) &&
        (s.february === undefined || isAmount(s.february)),
    );
  const ok =
    isRate(r.pf?.employeeRate) &&
    isRate(r.pf?.employerRate) &&
    isRate(r.pf?.epsRate) &&
    isAmount(r.pf?.wageCeiling) &&
    typeof r.pf?.onFullWages === 'boolean' &&
    isRate(r.esi?.employeeRate) &&
    isRate(r.esi?.employerRate) &&
    isAmount(r.esi?.grossThreshold) &&
    slabsOk(r.ptSlabs) &&
    isRate(r.gratuityRate) &&
    typeof r.labourCodeWages === 'boolean' &&
    typeof r.stipendDeductions === 'boolean' &&
    typeof r.ptSlabsByOffice === 'object' &&
    Object.values(r.ptSlabsByOffice).every(slabsOk) &&
    typeof r.stipendMinimumByOffice === 'object' &&
    Object.values(r.stipendMinimumByOffice).every(isAmount);
  if (!ok)
    throw new BadRequestException('The settings are incomplete or not in the expected form.');
  return {
    pf: r.pf,
    esi: r.esi,
    ptSlabs: r.ptSlabs,
    gratuityRate: r.gratuityRate,
    labourCodeWages: r.labourCodeWages,
    stipendDeductions: r.stipendDeductions,
    ptSlabsByOffice: r.ptSlabsByOffice,
    stipendMinimumByOffice: r.stipendMinimumByOffice,
    ...(r.tax ? { tax: validTax(r.tax) } : {}),
  };
}

/** The tax rules keep their shape; a slab table must end open (upTo null). */
function validTax(tax: TaxRules): TaxRules {
  const isAmount = (v: unknown) => typeof v === 'string' && /^\d{1,12}(\.\d{1,2})?$/.test(v);
  const regimeOk = (r: TaxRules['new'] | undefined) =>
    !!r &&
    Array.isArray(r.slabs) &&
    r.slabs.length > 0 &&
    r.slabs.every((s) => (s.upTo === null || isAmount(s.upTo)) && isAmount(s.rate)) &&
    r.slabs[r.slabs.length - 1]!.upTo === null &&
    isAmount(r.standardDeduction) &&
    isAmount(r.rebateLimit) &&
    isAmount(r.rebateMax);
  const ok =
    typeof tax === 'object' &&
    regimeOk(tax.new) &&
    regimeOk(tax.old) &&
    isAmount(tax.cessRate) &&
    Array.isArray(tax.surcharge) &&
    typeof tax.caps === 'object' &&
    typeof tax.gratuity === 'object' &&
    typeof tax.bonus === 'object' &&
    typeof tax.leaveEncashment === 'object';
  if (!ok) throw new BadRequestException('The income-tax settings are not in the expected form.');
  return { ...DEFAULT_TAX_RULES, ...tax };
}
