import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import {
  DEFAULT_TAX_RULES,
  computeAnnualTax,
  form138Due,
  fromPaise,
  maskTail,
  statutoryBonus,
  taxYearLabel,
  taxYearMonths,
  toPaise,
  type ApplyBonusInput,
  type BonusWorking,
  type DecideTaxProofInput,
  type Form130PartB,
  type Form138Quarter,
  type PayLine,
  type PayRules,
  type SaveTaxDeclarationInput,
  type SubmitTaxProofInput,
  type TaxDeclaration,
  type TaxDeclarationRow,
  type TaxProof,
  type TdsExplanation,
} from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CredentialCipher } from '../credentials/credential-cipher';
import { decodeUpload } from '../documents/documents.upload';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';
import { HrDocumentsService } from '../people/hr-documents.service';
import {
  assertCanSeePay,
  isoDate,
  monthOf,
  monthStart,
  translatePayrollError,
} from './payroll-errors';
import { PayrollService, payAad, requireEmployee, sealedFrom } from './payroll.service';
import {
  amountsOf,
  blankTaxYear,
  loadTaxYears,
  taxRulesOf,
  tdsOf,
  yearEnd,
  yearStart,
  type DeclarationRow,
  type StoredTds,
} from './tax-context';

interface ProofRow {
  id: string;
  head: TaxProof['head'];
  amount: string;
  filename: string;
  status: TaxProof['status'];
  accepted_amount: string | null;
  reason: string | null;
  created_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
}

const stale = () => new ConflictException('Someone changed this meanwhile. Reload and try again.');

/**
 * Income tax on salary (spec §4.8, phase 2b): each person's regime and
 * declarations, proofs into the HR vault, the projection a run deducts
 * (s.392 of the Income-tax Act 2025), Form 138 (was 24Q) data each quarter,
 * Form 130 Part B (was Form 16) each year, and the statutory bonus working.
 * Who sees what is the database's: HR and the approvers, and each person
 * their own.
 */
@Injectable()
export class PayrollTaxService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
    private readonly config: AppConfigService,
    private readonly payroll: PayrollService,
    private readonly vault: HrDocumentsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── Declarations ───────────────────────────────────────────────────────

  async declarations(ctx: RlsContext, year: number): Promise<TaxDeclarationRow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{
        employee_id: string;
        employee_code: string;
        full_name: string;
        regime: TaxDeclarationRow['regime'] | null;
        declared: boolean;
        submitted_at: Date | null;
        locked_at: Date | null;
        pending: number;
        accepted: number;
        projected: { annualTaxWithOneOffs?: string } | null;
      }>(
        `SELECT e.id AS employee_id, e.employee_code, e.full_name, d.regime, d.id IS NOT NULL AS declared,
                d.submitted_at, d.locked_at,
                (SELECT count(*)::int FROM hsdg.tax_proofs p
                  WHERE p.declaration_id = d.id AND p.status = 'submitted') AS pending,
                (SELECT count(*)::int FROM hsdg.tax_proofs p
                  WHERE p.declaration_id = d.id AND p.status = 'accepted') AS accepted,
                (SELECT l.inputs -> 'tds' FROM hsdg.payroll_lines l
                  WHERE l.employee_id = e.id AND l.kind = 'salary'
                    AND l.month BETWEEN $2::date AND $3::date AND l.inputs ? 'tds'
                  ORDER BY l.month DESC LIMIT 1) AS projected
           FROM hsdg.employees e
           LEFT JOIN hsdg.tax_declarations d ON d.employee_id = e.id AND d.tax_year = $1
          WHERE e.date_of_joining <= $3::date
            AND (e.date_of_exit IS NULL OR e.date_of_exit >= $2::date)
            AND EXISTS (SELECT 1 FROM hsdg.salary_structures s
                         WHERE s.employee_id = e.id AND s.kind = 'salary' AND s.status = 'approved')
          ORDER BY e.employee_code`,
        [year, `${yearStart(year)}-01`, `${yearEnd(year)}-31`],
      );
      const years = await loadTaxYears(client, year);
      return rows.map((r) => ({
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        fullName: r.full_name,
        regime: r.regime ?? 'new',
        declared: r.declared,
        submittedAt: r.submitted_at?.toISOString() ?? null,
        lockedAt: r.locked_at?.toISOString() ?? null,
        proofsPending: r.pending,
        proofsAccepted: r.accepted,
        projectedTax: r.projected?.annualTaxWithOneOffs ?? '0.00',
        tdsToDate: fromPaise(years.get(r.employee_id)?.tdsToDate ?? 0n),
      }));
    });
  }

  async declaration(ctx: RlsContext, year: number, employeeId: string): Promise<TaxDeclaration> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      await requireEmployeeRow(client, employeeId);
      return declarationWith(client, year, employeeId);
    });
  }

  async ownDeclaration(ctx: RlsContext, year: number): Promise<TaxDeclaration> {
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, (client) => declarationWith(client, year, employeeId));
  }

  /** HR saves for a person, or a person for themself (`own`). */
  async saveDeclaration(
    ctx: RlsContext,
    year: number,
    employeeId: string | null,
    input: SaveTaxDeclarationInput,
  ): Promise<TaxDeclaration> {
    const own = employeeId === null;
    const who = employeeId ?? requireEmployee(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      if (!own) {
        await assertCanSeePay(client);
        await requireEmployeeRow(client, who);
      }
      const current = await declarationRow(client, year, who);
      // The regime is fixed for the year once a run has taxed on it (the guard says so).
      const prev = input.previousEmployment ?? null;
      try {
        if (!current) {
          if (input.version !== 0) throw stale();
          await client.query(
            `INSERT INTO hsdg.tax_declarations
               (employee_id, tax_year, regime, amounts, previous_employment, submitted_at)
             VALUES ($1, $2, $3, $4, $5, now())`,
            [who, year, input.regime, JSON.stringify(input.amounts), prev && JSON.stringify(prev)],
          );
        } else {
          const { rowCount } = await client.query(
            `UPDATE hsdg.tax_declarations
                SET regime = $3, amounts = $4, previous_employment = $5, submitted_at = now(),
                    version = version + 1
              WHERE id = $1 AND version = $2`,
            [
              current.id,
              input.version,
              input.regime,
              JSON.stringify(input.amounts),
              prev && JSON.stringify(prev),
            ],
          );
          if (rowCount === 0) throw stale();
        }
      } catch (err) {
        if (err instanceof ConflictException) throw err;
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.tax_declaration.saved',
        objectType: 'employee',
        objectId: who,
        after: { taxYear: year, regime: input.regime, own },
      });
      return declarationWith(client, year, who);
    });
  }

  async lockDeclaration(
    ctx: RlsContext,
    year: number,
    employeeId: string,
    version: number,
    locked: boolean,
  ): Promise<TaxDeclaration> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const current = await declarationRow(client, year, employeeId);
      if (!current) throw new BadRequestException('Nothing declared yet to lock.');
      if (current.version !== version) throw stale();
      try {
        await client.query(
          `UPDATE hsdg.tax_declarations
              SET locked_at = CASE WHEN $2 THEN now() END, version = version + 1
            WHERE id = $1`,
          [current.id, locked],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: locked ? 'payroll.tax_declaration.locked' : 'payroll.tax_declaration.unlocked',
        objectType: 'employee',
        objectId: employeeId,
        after: { taxYear: year },
      });
      return declarationWith(client, year, employeeId);
    });
  }

  // ── Proofs ─────────────────────────────────────────────────────────────

  /** File a proof into the HR vault (kind tax_proof) against a head. */
  async submitProof(
    ctx: RlsContext,
    year: number,
    employeeId: string | null,
    input: SubmitTaxProofInput,
  ): Promise<TaxDeclaration> {
    const who = employeeId ?? requireEmployee(ctx);
    const decoded = decodeUpload(input.contentBase64, this.config.get('DOCUMENT_MAX_BYTES'));
    const documentId = randomUUID();
    const reference = this.storage.newReference(`hr/${who}`, documentId);
    const contentType = input.contentType ?? 'application/octet-stream';
    await this.storage.write(reference, decoded.buffer, contentType);
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        if (employeeId !== null) {
          await assertCanSeePay(client);
          await requireEmployeeRow(client, who);
        }
        const decl = await declarationRow(client, year, who);
        if (!decl) throw new BadRequestException('Save the declaration before adding proofs.');
        try {
          await client.query(
            `SELECT hsdg.file_tax_proof_document($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              documentId,
              who,
              `Tax proof ${taxYearLabel(year)}: ${input.head}`,
              input.filename,
              contentType,
              decoded.sizeBytes,
              decoded.checksumSha256,
              reference,
            ],
          );
          await client.query(
            `INSERT INTO hsdg.tax_proofs
               (declaration_id, employee_id, head, amount, hr_document_id, filename)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [decl.id, who, input.head, input.amount, documentId, input.filename],
          );
        } catch (err) {
          throw translatePayrollError(err);
        }
        await this.audit.recordWith(client, ctx, {
          action: 'payroll.tax_proof.submitted',
          objectType: 'employee',
          objectId: who,
          after: { taxYear: year, head: input.head, amount: input.amount, documentId },
        });
        return declarationWith(client, year, who);
      });
    } catch (err) {
      await this.storage.remove(reference).catch(() => undefined);
      throw err;
    }
  }

  async decideProof(
    ctx: RlsContext,
    proofId: string,
    input: DecideTaxProofInput,
  ): Promise<TaxDeclaration> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{
        employee_id: string;
        tax_year: number;
        amount: string;
        status: string;
      }>(
        `SELECT p.employee_id, d.tax_year, p.amount, p.status
           FROM hsdg.tax_proofs p JOIN hsdg.tax_declarations d ON d.id = p.declaration_id
          WHERE p.id = $1`,
        [proofId],
      );
      const proof = rows[0];
      if (!proof) throw new NotFoundException('Proof not found.');
      const accept = input.decision === 'accept';
      const accepted = accept ? (input.acceptedAmount ?? proof.amount) : null;
      if (accepted !== null && toPaise(accepted) > toPaise(proof.amount)) {
        throw new BadRequestException('Accept no more than the proof claims.');
      }
      if (!accept && !input.reason?.trim()) {
        throw new BadRequestException('Say why the proof is rejected.');
      }
      try {
        await client.query(
          `UPDATE hsdg.tax_proofs SET status = $2, accepted_amount = $3, reason = $4 WHERE id = $1`,
          [proofId, accept ? 'accepted' : 'rejected', accepted, input.reason?.trim() || null],
        );
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: accept ? 'payroll.tax_proof.accepted' : 'payroll.tax_proof.rejected',
        objectType: 'employee',
        objectId: proof.employee_id,
        after: { proofId, acceptedAmount: accepted, reason: input.reason ?? null },
      });
      return declarationWith(client, proof.tax_year, proof.employee_id);
    });
  }

  /** The proof's file from the vault (HR and the approvers; the download is audited). */
  async proofFile(
    ctx: RlsContext,
    proofId: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const ref = await this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{ employee_id: string; hr_document_id: string }>(
        `SELECT employee_id, hr_document_id FROM hsdg.tax_proofs WHERE id = $1`,
        [proofId],
      );
      if (!rows[0]) throw new NotFoundException('Proof not found.');
      return rows[0];
    });
    return this.vault.download(ctx, ref.employee_id, ref.hr_document_id);
  }

  // ── TDS ────────────────────────────────────────────────────────────────

  /** Why a month's TDS is what it is: the projection the run stored. */
  async explainTds(ctx: RlsContext, employeeId: string, month: string): Promise<TdsExplanation> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { rows } = await client.query<{ full_name: string; tds: StoredTds | null }>(
        `SELECT l.full_name, l.inputs -> 'tds' AS tds
           FROM hsdg.payroll_lines l
          WHERE l.employee_id = $1 AND l.month = $2 AND l.kind = 'salary'`,
        [employeeId, monthStart(month)],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('No salary computed for this person that month.');
      if (!r.tds) {
        throw new NotFoundException('HR entered this month’s TDS by hand; there is no projection.');
      }
      return { ...r.tds, employeeId, fullName: r.full_name };
    });
  }

  // ── Form 138 (was 24Q) ─────────────────────────────────────────────────

  async form138(ctx: RlsContext, year: number, quarter: 1 | 2 | 3 | 4): Promise<Form138Quarter> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      return (await this.form138With(client, year, quarter)).quarter;
    });
  }

  /** The statement data as a workbook to key into the return utility (full PAN; audited). */
  async form138File(
    ctx: RlsContext,
    year: number,
    quarter: 1 | 2 | 3 | 4,
  ): Promise<{ data: Buffer; filename: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const { quarter: q, pans } = await this.form138With(client, year, quarter);
      const pan = (id: string) => {
        const sealed = pans.get(id);
        if (!sealed || !this.cipher.ready) return '';
        return this.cipher.openText(sealed, payAad('employee_pay_details', id, 'pan'));
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['Month', 'TDS in the runs', 'Challan amount', 'Challan number', 'Deposited on'],
          ...q.challans.map((c) => [
            c.month,
            Number(c.tdsInRuns),
            Number(c.amount),
            c.challanNumber ?? '',
            c.paidOn ?? '',
          ]),
        ]),
        'Challans',
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          [
            'Employee code',
            'Name',
            'PAN',
            'Section',
            'Month',
            'Date paid',
            'Amount paid',
            'TDS deducted',
          ],
          ...q.deductees.map((d) => [
            d.employeeCode,
            d.fullName,
            pan(d.employeeId),
            '392',
            d.month,
            d.paidOn ?? '',
            Number(d.amountPaid),
            Number(d.tds),
          ]),
        ]),
        'Deductees',
      );
      if (quarter === 4) {
        const people = [...new Set(q.deductees.map((d) => d.employeeId))];
        const rows: (string | number)[][] = [
          [
            'Employee code',
            'Name',
            'PAN',
            'Regime',
            'Gross salary',
            'Exemptions',
            'Standard deduction',
            'Professional tax',
            'Other income',
            'Chapter deductions',
            'Total income',
            'Tax',
            'Rebate',
            'Surcharge',
            'Cess',
            'Tax payable',
            'TDS deducted',
          ],
        ];
        for (const id of people) {
          const f = await form130With(client, year, id);
          const c = f.computation;
          const sum = (xs: { amount: string }[]) =>
            Number(fromPaise(xs.reduce((s, x) => s + toPaise(x.amount), 0n)));
          rows.push([
            f.employeeCode,
            f.fullName,
            pan(id),
            c.regime,
            Number(c.grossSalary),
            sum(c.exemptions),
            Number(c.standardDeduction),
            Number(c.professionalTax),
            Number(c.otherIncome),
            sum(c.deductions),
            Number(c.totalIncome),
            Number(c.taxOnIncome),
            Number(c.rebate),
            Number(c.surcharge),
            Number(c.cess),
            Number(c.taxPayable),
            Number(f.tdsDeducted),
          ]);
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Annexure II');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.form138.exported',
        objectType: 'payroll_tax',
        after: { taxYear: year, quarter, deductees: q.deductees.length },
      });
      return {
        data: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
        filename: `Form 138 ${taxYearLabel(year)} Q${quarter}.xlsx`,
      };
    });
  }

  private async form138With(
    client: PoolClient,
    year: number,
    quarter: 1 | 2 | 3 | 4,
  ): Promise<{
    quarter: Form138Quarter;
    pans: Map<string, NonNullable<ReturnType<typeof sealedFrom>>>;
  }> {
    const months = taxYearMonths(year).slice((quarter - 1) * 3, quarter * 3);
    const lines = await client.query<{
      employee_id: string;
      employee_code: string;
      full_name: string;
      month: string;
      line: PayLine;
      paid_at: Date | null;
      status: string;
      pan_last4: string | null;
    }>(
      `SELECT l.employee_id, l.employee_code, l.full_name, l.month, l.line, l.paid_at, r.status,
              d.pan_last4
         FROM hsdg.payroll_lines l
         JOIN hsdg.payroll_runs r ON r.id = l.run_id
         LEFT JOIN hsdg.employee_pay_details d ON d.employee_id = l.employee_id
        WHERE l.kind = 'salary' AND l.month = ANY ($1::date[])
          AND r.status NOT IN ('draft', 'computed')
        ORDER BY l.month, l.employee_code`,
      [months.map(monthStart)],
    );
    const challans = await client.query<{
      month: string;
      amount: string;
      challan_number: string;
      paid_on: string;
    }>(
      `SELECT month, amount, challan_number, paid_on FROM hsdg.statutory_payments
        WHERE kind = 'tds' AND month = ANY ($1::date[])`,
      [months.map(monthStart)],
    );
    const panRows = await client.query<{
      employee_id: string;
      ciphertext: Buffer | null;
      iv: Buffer | null;
      auth_tag: Buffer | null;
      key_version: number | null;
    }>(
      `SELECT employee_id, pan_ciphertext AS ciphertext, pan_iv AS iv, pan_auth_tag AS auth_tag,
              pan_key_version AS key_version
         FROM hsdg.employee_pay_details
        WHERE employee_id = ANY ($1::uuid[])`,
      [[...new Set(lines.rows.map((l) => l.employee_id))]],
    );
    const pans = new Map<string, NonNullable<ReturnType<typeof sealedFrom>>>();
    for (const r of panRows.rows) {
      const s = sealedFrom(r);
      if (s) pans.set(r.employee_id, s);
    }

    const warnings: string[] = [];
    let paid = 0n;
    let tds = 0n;
    const deductees = lines.rows.map((l) => {
      const t = tdsOf(l.line);
      paid += toPaise(l.line.gross);
      tds += t;
      return {
        employeeId: l.employee_id,
        employeeCode: l.employee_code,
        fullName: l.full_name,
        panMasked: l.pan_last4 ? maskTail(`XXXXXX${l.pan_last4}`) : null,
        month: monthOf(l.month),
        paidOn: isoDate(l.paid_at),
        amountPaid: l.line.gross,
        tds: fromPaise(t),
      };
    });
    const noPan = [
      ...new Set(deductees.filter((d) => !pans.has(d.employeeId)).map((d) => d.fullName)),
    ];
    if (noPan.length > 0) {
      warnings.push(
        `No PAN recorded for ${noPan.join(', ')}: the statement needs it (without one, tax is due at the higher rate).`,
      );
    }
    let deposited = 0n;
    const challanRows = months.map((m) => {
      const inRuns = lines.rows
        .filter((l) => monthOf(l.month) === m)
        .reduce((s, l) => s + tdsOf(l.line), 0n);
      const c = challans.rows.find((x) => monthOf(x.month) === m);
      if (c) deposited += toPaise(c.amount);
      if (inRuns > 0n && !c) warnings.push(`TDS for ${m} is not recorded as deposited.`);
      if (c && toPaise(c.amount) !== inRuns) {
        warnings.push(
          `The ${m} challan (${c.amount}) differs from the TDS in the runs (${fromPaise(inRuns)}).`,
        );
      }
      return {
        month: m,
        amount: c?.amount ?? '0.00',
        challanNumber: c?.challan_number ?? null,
        paidOn: c ? isoDate(c.paid_on) : null,
        tdsInRuns: fromPaise(inRuns),
      };
    });
    const unpaidRuns = lines.rows.filter((l) => !['paid', 'locked'].includes(l.status));
    if (unpaidRuns.length > 0) warnings.push('Some runs in the quarter are not yet paid.');
    return {
      quarter: {
        taxYear: year,
        quarter,
        dueOn: form138Due(year, quarter),
        challans: challanRows,
        deductees,
        totals: {
          amountPaid: fromPaise(paid),
          tds: fromPaise(tds),
          deposited: fromPaise(deposited),
        },
        warnings,
      },
      pans,
    };
  }

  // ── Form 130 Part B (was Form 16) ──────────────────────────────────────

  async form130(ctx: RlsContext, year: number, employeeId: string): Promise<Form130PartB> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      await requireEmployeeRow(client, employeeId);
      return form130With(client, year, employeeId);
    });
  }

  async ownForm130(ctx: RlsContext, year: number): Promise<Form130PartB> {
    const employeeId = requireEmployee(ctx);
    return this.db.withRlsContext(ctx, (client) => form130With(client, year, employeeId));
  }

  // ── Statutory bonus ────────────────────────────────────────────────────

  async bonus(ctx: RlsContext, year: number, rate?: string): Promise<BonusWorking> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      return this.bonusWith(client, year, rate);
    });
  }

  /** Add each eligible person's bonus to a month's inputs (once a year). */
  async applyBonus(ctx: RlsContext, year: number, input: ApplyBonusInput): Promise<BonusWorking> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertCanSeePay(client);
      const w = await this.bonusWith(client, year, input.ratePercent);
      const due = w.rows.filter((r) => r.eligible && !r.appliedMonth && toPaise(r.amount) > 0n);
      if (due.length === 0)
        throw new BadRequestException('Nobody is due a bonus not already added.');
      try {
        for (const r of due) {
          await client.query(
            `INSERT INTO hsdg.payroll_inputs (month, employee_id, kind, amount, note, source)
             VALUES ($1, $2, 'bonus', $3, $4, 'bonus')`,
            [monthStart(input.month), r.employeeId, r.amount, bonusNote(year)],
          );
        }
      } catch (err) {
        throw translatePayrollError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'payroll.bonus.applied',
        objectType: 'payroll_tax',
        after: { taxYear: year, rate: input.ratePercent, month: input.month, people: due.length },
      });
      return this.bonusWith(client, year, input.ratePercent);
    });
  }

  private async bonusWith(client: PoolClient, year: number, rate?: string): Promise<BonusWorking> {
    const { rules } = await this.payroll.settingsWith(client, `${yearStart(year)}-01`);
    const tax = taxRulesOf(rules);
    const ratePercent = rate ?? tax.bonus.minRate;
    const { rows } = await client.query<{
      employee_id: string;
      employee_code: string;
      full_name: string;
      month: string;
      line: PayLine;
    }>(
      `SELECT l.employee_id, l.employee_code, l.full_name, l.month, l.line
         FROM hsdg.payroll_lines l JOIN hsdg.payroll_runs r ON r.id = l.run_id
        WHERE l.kind = 'salary' AND l.month BETWEEN $1::date AND $2::date
          AND r.status NOT IN ('draft', 'computed')
        ORDER BY l.employee_code, l.month`,
      [`${yearStart(year)}-01`, `${yearEnd(year)}-01`],
    );
    const applied = await client.query<{ employee_id: string; month: string }>(
      `SELECT employee_id, month FROM hsdg.payroll_inputs
        WHERE source = 'bonus' AND note = $1`,
      [bonusNote(year)],
    );
    const appliedOf = new Map(applied.rows.map((a) => [a.employee_id, monthOf(a.month)]));
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.employee_id, [...(by.get(r.employee_id) ?? []), r]);
    let total = 0n;
    const out: BonusWorking['rows'] = [];
    for (const [employeeId, ls] of by) {
      let b: ReturnType<typeof statutoryBonus>;
      try {
        b = statutoryBonus({
          months: ls.map((l) => ({
            month: monthOf(l.month),
            wages: l.line.pfWages,
            daysWorked: l.line.payableDays,
          })),
          ratePercent,
          rules: tax,
        });
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
      if (b.eligible) total += toPaise(b.amount);
      out.push({
        employeeId,
        employeeCode: ls[0]!.employee_code,
        fullName: ls[0]!.full_name,
        eligible: b.eligible,
        reason: b.reason,
        bonusWages: b.bonusWages,
        amount: b.amount,
        appliedMonth: appliedOf.get(employeeId) ?? null,
      });
    }
    return {
      taxYear: year,
      ratePercent,
      minRate: tax.bonus.minRate,
      maxRate: tax.bonus.maxRate,
      dueBy: `${year + 1}-11-30`,
      rows: out,
      total: fromPaise(total),
    };
  }
}

const bonusNote = (year: number) => `Statutory bonus ${taxYearLabel(year)}`;

async function requireEmployeeRow(client: PoolClient, employeeId: string): Promise<void> {
  const { rows } = await client.query(`SELECT 1 FROM hsdg.employees WHERE id = $1`, [employeeId]);
  if (!rows[0]) throw new NotFoundException('Employee not found.');
}

async function declarationRow(
  client: PoolClient,
  year: number,
  employeeId: string,
): Promise<DeclarationRow | null> {
  const { rows } = await client.query<DeclarationRow>(
    `SELECT d.id, d.employee_id, d.tax_year, d.regime, d.amounts, d.previous_employment,
            d.submitted_at, d.locked_at, u.display_name AS locked_by, d.version
       FROM hsdg.tax_declarations d LEFT JOIN hsdg.users u ON u.id = d.locked_by_user_id
      WHERE d.employee_id = $1 AND d.tax_year = $2`,
    [employeeId, year],
  );
  return rows[0] ?? null;
}

async function declarationWith(
  client: PoolClient,
  year: number,
  employeeId: string,
): Promise<TaxDeclaration> {
  const d = await declarationRow(client, year, employeeId);
  const proofs = d
    ? (
        await client.query<ProofRow>(
          `SELECT p.id, p.head, p.amount, p.filename, p.status, p.accepted_amount, p.reason,
                  p.created_at, u.display_name AS decided_by, p.decided_at
             FROM hsdg.tax_proofs p LEFT JOIN hsdg.users u ON u.id = p.decided_by_user_id
            WHERE p.declaration_id = $1
            ORDER BY p.created_at`,
          [d.id],
        )
      ).rows
    : [];
  return {
    employeeId,
    id: d?.id ?? null,
    taxYear: year,
    regime: d?.regime ?? 'new',
    amounts: amountsOf(d?.amounts),
    previousEmployment: d?.previous_employment ?? null,
    submittedAt: d?.submitted_at?.toISOString() ?? null,
    lockedAt: d?.locked_at?.toISOString() ?? null,
    lockedBy: d?.locked_by ?? null,
    version: d?.version ?? 0,
    proofs: proofs.map((p) => ({
      id: p.id,
      head: p.head,
      amount: p.amount,
      filename: p.filename,
      status: p.status,
      acceptedAmount: p.accepted_amount,
      reason: p.reason,
      submittedAt: p.created_at.toISOString(),
      decidedBy: p.decided_by,
      decidedAt: p.decided_at?.toISOString() ?? null,
    })),
  };
}

/**
 * The year's salary, exemptions, deductions and tax as paid (Part B). A
 * person reads their own only through released payslips (RLS), so their copy
 * counts what they have been paid.
 */
async function form130With(
  client: PoolClient,
  year: number,
  employeeId: string,
): Promise<Form130PartB> {
  const { rows } = await client.query<{
    employee_code: string;
    full_name: string;
    date_of_joining: string;
    date_of_exit: string | null;
    pan_last4: string | null;
  }>(
    `SELECT e.employee_code, e.full_name, e.date_of_joining, e.date_of_exit, d.pan_last4
       FROM hsdg.employees e LEFT JOIN hsdg.employee_pay_details d ON d.employee_id = e.id
      WHERE e.id = $1`,
    [employeeId],
  );
  const e = rows[0];
  if (!e) throw new NotFoundException('Employee not found.');
  const years = await loadTaxYears(client, year, { employeeIds: [employeeId] });
  const person = years.get(employeeId) ?? blankTaxYear();
  // A person can't read the settings (RLS): their copy uses the seeded rules.
  const settings = await client.query<{ rules: PayRules }>(
    `SELECT rules FROM hsdg.pay_settings WHERE effective_from <= $1::date
      ORDER BY effective_from DESC LIMIT 1`,
    [`${yearEnd(year)}-31`],
  );
  const rules = settings.rows[0] ? taxRulesOf(settings.rows[0].rules) : DEFAULT_TAX_RULES;
  const computation = computeAnnualTax({
    salary: person.paid,
    regime: person.regime,
    amounts: person.amounts,
    proved: person.locked ? person.proved : null,
    rules,
  });
  const open = await client.query(
    `SELECT 1 FROM hsdg.payroll_runs
      WHERE kind = 'salary' AND month BETWEEN $1::date AND $2::date
        AND status IN ('draft', 'computed', 'submitted', 'approved') LIMIT 1`,
    [`${yearStart(year)}-01`, `${yearEnd(year)}-01`],
  );
  const from =
    e.date_of_joining > `${yearStart(year)}-01` ? e.date_of_joining : `${yearStart(year)}-01`;
  const to =
    e.date_of_exit && e.date_of_exit < `${yearEnd(year)}-31`
      ? e.date_of_exit
      : `${yearEnd(year)}-31`;
  const today = new Date().toISOString().slice(0, 10);
  return {
    taxYear: year,
    employeeId,
    employeeCode: e.employee_code,
    fullName: e.full_name,
    panMasked: e.pan_last4 ? maskTail(`XXXXXX${e.pan_last4}`) : null,
    periodFrom: isoDate(from)!,
    periodTo: isoDate(to)!,
    computation,
    previousEmployment: person.previous,
    // This employer's TDS; the previous employer's counts towards the balance.
    tdsDeducted: fromPaise(person.tdsToDate - toPaise(person.previous?.tds ?? '0')),
    balance: fromPaise(toPaise(computation.taxPayable) - person.tdsToDate),
    final: today > `${yearEnd(year)}-31` && !open.rows[0],
  };
}
