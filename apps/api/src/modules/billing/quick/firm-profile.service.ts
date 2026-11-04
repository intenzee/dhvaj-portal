import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FIRM_LOGO_MAX_BYTES,
  FIRM_PROFILE_FIELDS,
  type FirmInvoiceProfile,
  type FirmProfileField,
  type SetFirmLogoInput,
  type UpdateFirmInvoiceProfileInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AuditService } from '../../audit/audit.service';
import { ImageError, pdfImage } from '../pdf-image';

const COLUMN: Record<FirmProfileField, string> = {
  pan: 'pan',
  phone: 'phone',
  website: 'website',
  bankAccountName: 'bank_account_name',
  bankName: 'bank_name',
  bankAccountNumber: 'bank_account_number',
  bankIfsc: 'bank_ifsc',
  bankBranch: 'bank_branch',
  upiId: 'upi_id',
};

/** Upper-cased on the way in: PAN, account number and IFSC are capitals. */
const UPPER: ReadonlySet<FirmProfileField> = new Set(['pan', 'bankAccountNumber', 'bankIfsc']);

/** The value stored for a field: trimmed, capitals where they must be, '' → null. Pure — tested. */
export function normaliseFirmField(field: FirmProfileField, v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim().replace(/\s+/g, field === 'bankAccountNumber' ? '' : ' ');
  if (!t) return null;
  return UPPER.has(field) ? t.toUpperCase() : t;
}

/**
 * Everything the invoice PDF prints about the firm, and its logo. Anyone
 * signed in reads it; partners change it (firm_settings RLS, and the API asks
 * billing.approve). Audited.
 */
@Injectable()
export class FirmProfileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(ctx: RlsContext): Promise<FirmInvoiceProfile> {
    return this.db.withRlsContext(ctx, (client) => this.read(client));
  }

  update(ctx: RlsContext, input: UpdateFirmInvoiceProfileInput): Promise<FirmInvoiceProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.read(client);
      const sets: string[] = [];
      const values: unknown[] = [];
      const changed: FirmProfileField[] = [];
      for (const field of FIRM_PROFILE_FIELDS) {
        if (input[field] === undefined) continue;
        values.push(normaliseFirmField(field, input[field] ?? null));
        sets.push(`${COLUMN[field]} = $${values.length}`);
        changed.push(field);
      }
      if (sets.length === 0) return before;
      try {
        await client.query(
          `UPDATE hsdg.firm_settings SET ${sets.join(', ')}, version = version + 1, updated_at = now()`,
          values,
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23514') {
          throw new BadRequestException(checkMessage((err as { constraint?: string }).constraint));
        }
        throw err;
      }
      const after = await this.read(client);
      await this.audit.recordWith(client, ctx, {
        action: 'firm_profile.updated',
        objectType: 'firm_settings',
        objectId: null,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      return after;
    });
  }

  setLogo(ctx: RlsContext, input: SetFirmLogoInput): Promise<FirmInvoiceProfile> {
    const data = Buffer.from(input.contentBase64 ?? '', 'base64');
    if (data.length === 0) throw new BadRequestException('The logo file is empty.');
    if (data.length > FIRM_LOGO_MAX_BYTES) {
      throw new BadRequestException(
        'The logo is over 500 KB; make it smaller and upload it again.',
      );
    }
    try {
      pdfImage(data, input.contentType);
    } catch (err) {
      if (err instanceof ImageError) throw new BadRequestException(err.message);
      throw err;
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(
        `UPDATE hsdg.firm_settings SET logo = $1, logo_content_type = $2,
                version = version + 1, updated_at = now()`,
        [data, input.contentType],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'firm_profile.logo_set',
        objectType: 'firm_settings',
        objectId: null,
        after: { contentType: input.contentType, bytes: data.length },
      });
      return this.read(client);
    });
  }

  clearLogo(ctx: RlsContext): Promise<FirmInvoiceProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      await client.query(
        `UPDATE hsdg.firm_settings SET logo = NULL, logo_content_type = NULL,
                version = version + 1, updated_at = now()`,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'firm_profile.logo_cleared',
        objectType: 'firm_settings',
        objectId: null,
      });
      return this.read(client);
    });
  }

  logo(ctx: RlsContext): Promise<{ contentType: string; data: Buffer }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        logo: Buffer | null;
        logo_content_type: string | null;
      }>(`SELECT logo, logo_content_type FROM hsdg.firm_settings LIMIT 1`);
      const r = rows[0];
      if (!r?.logo || !r.logo_content_type) throw new NotFoundException('No logo is on file.');
      return { contentType: r.logo_content_type, data: r.logo };
    });
  }

  private async read(client: PoolClient): Promise<FirmInvoiceProfile> {
    const { rows } = await client.query<{
      firm_name: string;
      address: string | null;
      gstin: string | null;
      state_code: string | null;
      frn: string | null;
      email: string | null;
      pan: string | null;
      phone: string | null;
      website: string | null;
      bank_account_name: string | null;
      bank_name: string | null;
      bank_account_number: string | null;
      bank_ifsc: string | null;
      bank_branch: string | null;
      upi_id: string | null;
      logo_content_type: FirmInvoiceProfile['logoContentType'];
    }>(
      `SELECT firm_name, address, gstin, state_code, frn, email, pan, phone, website,
              bank_account_name, bank_name, bank_account_number, bank_ifsc, bank_branch, upi_id,
              logo_content_type
         FROM hsdg.firm_settings LIMIT 1`,
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('The firm has no settings row.');
    return {
      firmName: r.firm_name,
      address: r.address,
      gstin: r.gstin,
      stateCode: r.state_code,
      frn: r.frn,
      email: r.email,
      pan: r.pan,
      phone: r.phone,
      website: r.website,
      bankAccountName: r.bank_account_name,
      bankName: r.bank_name,
      bankAccountNumber: r.bank_account_number,
      bankIfsc: r.bank_ifsc,
      bankBranch: r.bank_branch,
      upiId: r.upi_id,
      logoContentType: r.logo_content_type,
    };
  }
}

/** A failed CHECK named in words. */
function checkMessage(constraint: string | undefined): string {
  if (constraint?.includes('pan')) return 'That is not a valid PAN (e.g. AAAFH1234K).';
  if (constraint?.includes('ifsc')) return 'That is not a valid IFSC (e.g. HDFC0001234).';
  if (constraint?.includes('account_number'))
    return 'The account number is 6–20 letters or digits.';
  if (constraint?.includes('upi')) return 'That is not a valid UPI ID (e.g. firm@hdfcbank).';
  return 'One of the firm details is not valid.';
}
