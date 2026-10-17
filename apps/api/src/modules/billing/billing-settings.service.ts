import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { BillingSettings, UpdateBillingSettingsInput } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface SettingsRow {
  firm_name: string;
  address: string | null;
  gstin: string | null;
  state_code: string | null;
  sac_default: string;
  invoice_prefix: string;
  invoice_terms_days: number;
  invoice_reminder_days: number[];
  auto_invoice_reminders: boolean;
  tds_match_tolerance: string;
  version: number;
  updated_at: Date;
}

/** Column per settable field. */
const COLUMNS = {
  gstin: 'gstin',
  stateCode: 'state_code',
  sacDefault: 'sac_default',
  invoicePrefix: 'invoice_prefix',
  invoiceTermsDays: 'invoice_terms_days',
  invoiceReminderDays: 'invoice_reminder_days',
  autoInvoiceReminders: 'auto_invoice_reminders',
  tdsMatchTolerance: 'tds_match_tolerance',
} as const satisfies Record<Exclude<keyof UpdateBillingSettingsInput, 'version'>, string>;

/**
 * PS-201 · who the firm is on its tax invoices: GSTIN and state, the default
 * SAC, the number prefix and payment terms; and (PS-203) the automatic
 * payment reminders, and (PS-204) the 26AS match tolerance. One row, firm_settings; anyone
 * signed in reads it, partners change it (RLS) and the API asks billing.approve.
 */
@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(ctx: RlsContext): Promise<BillingSettings> {
    return this.db.withRlsContext(ctx, (client) => this.read(client));
  }

  update(ctx: RlsContext, input: UpdateBillingSettingsInput): Promise<BillingSettings> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.read(client);
      const next = { ...input };
      // Stored ascending and once each.
      if (next.invoiceReminderDays) {
        next.invoiceReminderDays = [...new Set(next.invoiceReminderDays)].sort((a, b) => a - b);
      }
      // The GSTIN names the state; say so rather than store a mismatch.
      if (next.gstin) {
        const fromGstin = next.gstin.slice(0, 2);
        if (next.stateCode === undefined) next.stateCode = fromGstin;
        else if (next.stateCode !== fromGstin) {
          throw new BadRequestException(
            `The GSTIN is registered in state ${fromGstin}; the state must match.`,
          );
        }
      }
      const sets: string[] = [];
      const values: unknown[] = [input.version];
      for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
        if (next[key] === undefined) continue;
        values.push(next[key]);
        sets.push(`${column} = $${values.length}`);
      }
      values.push(ctx.employeeId ?? null);
      let rowCount: number;
      try {
        const res = await client.query(
          `UPDATE hsdg.firm_settings
              SET ${[...sets, 'version = version + 1', `updated_by_employee_id = $${values.length}`].join(', ')}
            WHERE version = $1`,
          values,
        );
        rowCount = res.rowCount ?? 0;
      } catch (err) {
        if ((err as { code?: string }).code === '23514') {
          throw new BadRequestException("The firm's GSTIN and state do not agree.");
        }
        throw err;
      }
      if (rowCount === 0) {
        throw new ConflictException(
          'The billing settings changed since you loaded them; refresh and retry.',
        );
      }
      const after = await this.read(client);
      const changed = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
        (k) => next[k] !== undefined,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'billing_settings.updated',
        objectType: 'firm_settings',
        objectId: null,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      return after;
    });
  }

  private async read(client: PoolClient): Promise<BillingSettings> {
    const { rows } = await client.query<SettingsRow>(
      `SELECT firm_name, address, gstin, state_code, sac_default, invoice_prefix,
              invoice_terms_days, invoice_reminder_days, auto_invoice_reminders,
              tds_match_tolerance::text, version,
              updated_at
         FROM hsdg.firm_settings LIMIT 1`,
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('The firm has no settings row.');
    return {
      firmName: r.firm_name,
      address: r.address,
      gstin: r.gstin,
      stateCode: r.state_code,
      sacDefault: r.sac_default,
      invoicePrefix: r.invoice_prefix,
      invoiceTermsDays: r.invoice_terms_days,
      invoiceReminderDays: r.invoice_reminder_days,
      autoInvoiceReminders: r.auto_invoice_reminders,
      tdsMatchTolerance: r.tds_match_tolerance,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
    };
  }
}
