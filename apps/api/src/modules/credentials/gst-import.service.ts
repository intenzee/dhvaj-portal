import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  GST_IMPORT_ACTION,
  type GstImportAction,
  type GstImportPreview,
  type GstImportRequest,
  type GstImportResult,
  type GstImportRow,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { CredentialsService } from './credentials.service';
import { checkGstRows, parseGstWorkbook, type CheckedGstRow } from './gst-import';

/** More rows than this is not a client list. */
const MAX_ROWS = 3000;

/** A checked row with what the portal will do with it. */
interface PlannedRow extends CheckedGstRow {
  action: GstImportAction;
  entityId: string | null;
  entityName: string | null;
  registrationId: string | null;
  message: string | null;
}

interface Plan {
  sheet: string;
  headers: string[];
  mapping: GstImportPreview['mapping'];
  rows: PlannedRow[];
}

function failureMessage(err: unknown): string {
  const e = err as { code?: string; constraint?: string };
  if (err instanceof ConflictException || e.code === '23505')
    return 'This GSTIN or PAN is already on a client in another office that you cannot see.';
  if (err instanceof HttpException) return err.message;
  return 'Could not be saved.';
}

/**
 * ADR-0035 — brings a spreadsheet of GST clients into the portal: a client
 * per PAN (its GSTINs as registrations, a GST contact from the e-mail and
 * mobile), and each GSTIN's portal login sealed into the vault. Preview first;
 * the import re-reads the same file, so nothing is held between the two calls.
 * Each client commits on its own, so one bad client does not stop the rest.
 */
@Injectable()
export class GstImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    private readonly credentials: CredentialsService,
  ) {}

  async preview(ctx: RlsContext, req: GstImportRequest): Promise<GstImportPreview> {
    const plan = await this.plan(ctx, req);
    const counts = Object.fromEntries(
      Object.values(GST_IMPORT_ACTION).map((a) => [a, 0]),
    ) as GstImportPreview['counts'];
    for (const r of plan.rows) counts[r.action] += 1;
    return {
      sheet: plan.sheet,
      headers: plan.headers,
      mapping: plan.mapping,
      rows: plan.rows.map(toPreviewRow),
      counts,
      vaultReady: this.credentials.vaultReady,
    };
  }

  async import(ctx: RlsContext, req: GstImportRequest): Promise<GstImportResult> {
    const plan = await this.plan(ctx, req);
    if (!this.credentials.vaultReady && plan.rows.some((r) => r.login))
      throw new ServiceUnavailableException(
        'The file has GST logins but this server has no encryption key (CREDENTIALS_KEYS), so they cannot be saved. Ask the administrator to set it, then import again.',
      );

    const result: GstImportResult = {
      clientsCreated: 0,
      registrationsAdded: 0,
      loginsSaved: 0,
      unchanged: 0,
      failed: [],
    };
    // One transaction per client: new clients by PAN, existing ones by id.
    const groups = new Map<string, PlannedRow[]>();
    for (const r of plan.rows) {
      if (r.action === GST_IMPORT_ACTION.error) {
        result.failed.push({ row: r.row, gstin: r.gstin, message: r.message ?? 'Error.' });
        continue;
      }
      if (r.action === GST_IMPORT_ACTION.unchanged) {
        result.unchanged += 1;
        continue;
      }
      const key = r.action === GST_IMPORT_ACTION.createClient ? `pan:${r.pan}` : r.entityId!;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }

    for (const rows of groups.values()) {
      try {
        const done = await this.db.withRlsContext(ctx, (client) =>
          this.importClient(client, ctx, req.officeCode, rows),
        );
        result.clientsCreated += done.created ? 1 : 0;
        result.registrationsAdded += done.registrations;
        result.loginsSaved += done.logins;
      } catch (err) {
        const message = failureMessage(err);
        for (const r of rows) result.failed.push({ row: r.row, gstin: r.gstin, message });
      }
    }
    result.failed.sort((a, b) => a.row - b.row);

    await this.audit.record(ctx, {
      action: 'client_import.gst',
      objectType: 'client_import',
      after: {
        filename: req.filename,
        officeCode: req.officeCode,
        clientsCreated: result.clientsCreated,
        registrationsAdded: result.registrationsAdded,
        loginsSaved: result.loginsSaved,
        unchanged: result.unchanged,
        failed: result.failed.length,
      },
    });
    return result;
  }

  /** One client's rows, in the caller's transaction. */
  private async importClient(
    client: PoolClient,
    ctx: RlsContext,
    officeCode: string,
    rows: PlannedRow[],
  ): Promise<{ created: boolean; registrations: number; logins: number }> {
    const first = rows[0]!;
    let entityId = first.entityId;
    let created = false;
    let registrations = 0;

    if (first.action === GST_IMPORT_ACTION.createClient) {
      const contact = rows.find((r) => r.email || r.phone);
      const detail = await this.entities.createEntityWith(client, ctx, {
        legalName: first.legalName,
        ...(first.tradeName ? { tradeName: first.tradeName } : {}),
        typeSlug: first.typeSlug!,
        officeCode,
        pan: first.pan!,
        registrations: rows.map((r, i) => ({
          registrationType: 'gstin',
          registrationNumber: r.gstin,
          stateCode: r.stateCode!,
          isPrincipal: i === 0,
          source: 'client',
        })),
        contacts: contact
          ? [
              {
                fullName: contact.tradeName ?? contact.legalName,
                ...(contact.email ? { email: contact.email } : {}),
                ...(contact.phone ? { phone: contact.phone } : {}),
                isPrimary: true,
                contactType: 'gst',
              },
            ]
          : [],
      });
      entityId = detail.id;
      created = true;
      registrations = rows.length;
    } else {
      for (const r of rows.filter((x) => x.action === GST_IMPORT_ACTION.addRegistration)) {
        await this.entities.addRegistrationWith(client, ctx, entityId!, {
          registrationType: 'gstin',
          registrationNumber: r.gstin,
          stateCode: r.stateCode!,
          isPrincipal: false,
          source: 'client',
        });
        registrations += 1;
      }
    }

    const { rows: regs } = await client.query<{ id: string; registration_number: string }>(
      `SELECT id, registration_number FROM hsdg.entity_registrations
        WHERE entity_id = $1 AND registration_type = 'gstin'`,
      [entityId],
    );
    const regOf = new Map(regs.map((r) => [r.registration_number, r.id]));
    let logins = 0;
    for (const r of rows) {
      if (!r.login) continue;
      const registrationId = regOf.get(r.gstin);
      if (!registrationId) throw new BadRequestException(`GSTIN ${r.gstin} was not saved.`);
      await this.credentials.saveWith(client, ctx, { registrationId, portal: 'gst', ...r.login });
      logins += 1;
    }
    return { created, registrations, logins };
  }

  /** Reads the file and decides each row's action against what the caller can see. */
  private async plan(ctx: RlsContext, req: GstImportRequest): Promise<Plan> {
    const bytes = Buffer.from(req.contentBase64, 'base64');
    if (bytes.length === 0) throw new BadRequestException('The file is empty.');
    let parsed;
    try {
      parsed = parseGstWorkbook(bytes, req.mapping);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (parsed.rows.length === 0) throw new BadRequestException('The sheet has no client rows.');
    if (parsed.rows.length > MAX_ROWS)
      throw new BadRequestException(`At most ${MAX_ROWS} rows can be imported at once.`);
    const checked = checkGstRows(parsed.rows);

    const lookups = await this.db.withRlsContext(ctx, async (client) => {
      const office = await client.query(`SELECT 1 FROM hsdg.offices WHERE code = $1`, [
        req.officeCode,
      ]);
      if (office.rowCount === 0)
        throw new BadRequestException(`Unknown office "${req.officeCode}".`);
      const gstins = checked.filter((r) => !r.error).map((r) => r.gstin);
      const pans = [...new Set(checked.filter((r) => r.pan).map((r) => r.pan!))];
      const regs = await client.query<{
        id: string;
        registration_number: string;
        entity_id: string;
        legal_name: string;
      }>(
        `SELECT r.id, r.registration_number, r.entity_id, e.legal_name
           FROM hsdg.entity_registrations r JOIN hsdg.entities e ON e.id = r.entity_id
          WHERE r.registration_type = 'gstin' AND r.registration_number = ANY($1::text[])`,
        [gstins],
      );
      const byPan = await client.query<{ id: string; legal_name: string; pan: string }>(
        `SELECT id, legal_name, pan FROM hsdg.entities WHERE pan = ANY($1::text[])`,
        [pans],
      );
      return {
        regs: new Map(regs.rows.map((r) => [r.registration_number, r])),
        byPan: new Map(byPan.rows.map((e) => [e.pan, e])),
      };
    });

    const rows: PlannedRow[] = checked.map((r) => {
      const base = { ...r, entityId: null, entityName: null, registrationId: null };
      if (r.error) return { ...base, action: GST_IMPORT_ACTION.error, message: r.error };
      const reg = lookups.regs.get(r.gstin);
      if (reg)
        return {
          ...base,
          action: r.login ? GST_IMPORT_ACTION.updateLogin : GST_IMPORT_ACTION.unchanged,
          entityId: reg.entity_id,
          entityName: reg.legal_name,
          registrationId: reg.id,
          message: r.warning,
        };
      const entity = lookups.byPan.get(r.pan!);
      if (entity)
        return {
          ...base,
          action: GST_IMPORT_ACTION.addRegistration,
          entityId: entity.id,
          entityName: entity.legal_name,
          message: r.warning,
        };
      if (!r.typeSlug)
        return {
          ...base,
          action: GST_IMPORT_ACTION.error,
          message:
            'Cannot tell the kind of client from the PAN; add a Constitution column (e.g. "Private Limited Company").',
        };
      return { ...base, action: GST_IMPORT_ACTION.createClient, message: r.warning };
    });
    return { sheet: parsed.sheet, headers: parsed.headers, mapping: parsed.mapping, rows };
  }
}

/** The preview never carries the login itself. */
function toPreviewRow(r: PlannedRow): GstImportRow {
  return {
    row: r.row,
    gstin: r.gstin,
    legalName: r.legalName,
    tradeName: r.tradeName,
    pan: r.pan,
    stateCode: r.stateCode,
    typeSlug: r.typeSlug,
    hasLogin: r.login !== null,
    usernameHint: r.usernameHint,
    email: r.email,
    phone: r.phone,
    action: r.action,
    entityId: r.entityId,
    entityName: r.entityName,
    message: r.message,
  };
}
