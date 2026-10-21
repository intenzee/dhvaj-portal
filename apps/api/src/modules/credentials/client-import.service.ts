import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CLIENT_IMPORT_ACTION,
  type ClientImportAction,
  type ClientImportPreview,
  type ClientImportRequest,
  type ClientImportResult,
  type ClientImportRow,
  usernameHint,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { CredentialsService } from './credentials.service';
import {
  RULES_OF_FORM,
  clientsOfWorkbook,
  nameKey,
  parseClientWorkbook,
  periodKeysOfMark,
  previewLogin,
  sameFirstWord,
  similarNames,
  sourceLabel,
  type ParsedWorkbook,
  type WorkbookClient,
} from './client-workbook';

/** More rows than this is not a client list. */
const MAX_ROWS = 3000;

/** A client with what the portal will do with it. */
interface PlannedClient extends WorkbookClient {
  action: ClientImportAction;
  entityId: string | null;
  entityName: string | null;
  /** GSTINs / the TAN the client does not have yet. */
  newGstins: string[];
  newTan: boolean;
  /** How the portal's client was found: by PAN / GSTIN / TAN, its name, or a similar name. */
  matchedBy: 'key' | 'name' | 'similar' | null;
  /** The sheet's fuller name for the portal's client, when it has a shorter one. */
  rename: string | null;
}

interface Plan {
  book: ParsedWorkbook;
  clients: PlannedClient[];
}

type Tally = Omit<
  ClientImportResult,
  'failed' | 'notes' | 'clientsCreated' | 'clientsUpdated' | 'unchanged'
>;

const emptyTally = (): Tally => ({
  registrationsAdded: 0,
  loginsSaved: 0,
  schemesSet: 0,
  marksApplied: 0,
  marksAlreadyDone: 0,
  marksWithoutFiling: 0,
  marksNotAllowed: 0,
  marksRecorded: 0,
});

function failureMessage(err: unknown): string {
  const e = err as { code?: string };
  if (err instanceof ConflictException || e.code === '23505')
    return 'This PAN, GSTIN or TAN is already on a client in another office that you cannot see.';
  if (err instanceof HttpException) return err.message;
  return 'Could not be saved.';
}

const SCHEME = { monthly: 'regular', quarterly: 'qrmp' } as const;

/**
 * The sheet's name for the portal's client when it is the same name spelt
 * out or corrected ('aveer green' → 'Aveer Green Private Limited',
 * 'Jaynat Gupta' → 'Jayant Gupta'); never a shorter one, nor case alone.
 */
function fullerName(sheet: string, portal: string): string | null {
  const name = sheet.trim().replace(/\s+/g, ' ');
  return nameKey(name) !== nameKey(portal) &&
    nameKey(name).length >= nameKey(portal).length &&
    similarNames(name, portal)
    ? name
    : null;
}
const FREQUENCY_OF: Record<string, string> = {
  regular: 'Monthly',
  qrmp: 'Quarterly',
};

/**
 * ADR-0035 — brings the firm's login workbook into the portal. Each client
 * (rows joined by PAN or name across the GST and TDS sheets) is created or
 * matched; its GSTINs and TAN are added; its logins are sealed into the
 * vault (a GST login without its GSTIN waits on the client, by state); each
 * GSTIN's frequency becomes its first GST scheme; and the sheet's filed / NA
 * marks are kept as the client's GST return history (client_return_marks,
 * GSTIN or not) and close the matching GSTR-1 / 3B / 7 filings the importer
 * leads.
 * Preview first; the import re-reads the same file, so nothing is held
 * between the two calls. Each client commits on its own, and importing the
 * same file again only refreshes, so it is safe to repeat.
 */
@Injectable()
export class ClientImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    private readonly credentials: CredentialsService,
  ) {}

  async preview(ctx: RlsContext, req: ClientImportRequest): Promise<ClientImportPreview> {
    const { book, clients } = await this.plan(ctx, req);
    const counts = Object.fromEntries(
      Object.values(CLIENT_IMPORT_ACTION).map((a) => [a, 0]),
    ) as ClientImportPreview['counts'];
    for (const c of clients) counts[c.action] += 1;
    const live = clients.filter((c) => c.action !== CLIENT_IMPORT_ACTION.error);
    return {
      sheets: book.sheets,
      months: book.months,
      rows: clients.map(toPreviewRow),
      counts,
      logins: live.reduce((n, c) => n + c.logins.length, 0),
      marks: live.reduce((n, c) => n + c.gst.reduce((m, g) => m + g.marks.length, 0), 0),
      vaultReady: this.credentials.vaultReady,
    };
  }

  async import(ctx: RlsContext, req: ClientImportRequest): Promise<ClientImportResult> {
    const { clients } = await this.plan(ctx, req);
    if (!this.credentials.vaultReady && clients.some((c) => c.logins.length))
      throw new ServiceUnavailableException(
        'The file has logins but this server has no encryption key (CREDENTIALS_KEYS), so they cannot be saved. Ask the administrator to set it, then import again.',
      );

    const result: ClientImportResult = {
      clientsCreated: 0,
      clientsUpdated: 0,
      unchanged: 0,
      ...emptyTally(),
      failed: [],
      notes: [],
    };
    for (const c of clients) {
      const source = sourceLabel(c.sources);
      if (c.action === CLIENT_IMPORT_ACTION.error) {
        result.failed.push({ source, name: c.name, message: c.error ?? 'Error.' });
        continue;
      }
      if (c.action === CLIENT_IMPORT_ACTION.unchanged) {
        result.unchanged += 1;
        continue;
      }
      try {
        const notes: string[] = [];
        const tally = await this.db.withRlsContext(ctx, (client) =>
          this.importClient(client, ctx, req, c, notes),
        );
        if (c.action === CLIENT_IMPORT_ACTION.createClient) result.clientsCreated += 1;
        else result.clientsUpdated += 1;
        for (const k of Object.keys(tally) as (keyof Tally)[]) result[k] += tally[k];
        for (const message of notes) result.notes.push({ source, name: c.name, message });
      } catch (err) {
        result.failed.push({ source, name: c.name, message: failureMessage(err) });
      }
    }

    await this.audit.record(ctx, {
      action: 'client_import.workbook',
      objectType: 'client_import',
      after: {
        filename: req.filename,
        officeCode: req.officeCode,
        ...Object.fromEntries(
          Object.entries(result).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]),
        ),
      },
    });
    return result;
  }

  /** One client, in the caller's transaction. */
  private async importClient(
    client: PoolClient,
    ctx: RlsContext,
    req: ClientImportRequest,
    c: PlannedClient,
    notes: string[],
  ): Promise<Tally> {
    const { officeCode } = req;
    const tally = emptyTally();
    const tanRegistration = c.tan
      ? [{ registrationType: 'tan' as const, registrationNumber: c.tan, source: 'client' as const }]
      : [];
    let entityId = c.entityId;

    if (c.action === CLIENT_IMPORT_ACTION.createClient) {
      const detail = await this.entities.createEntityWith(client, ctx, {
        legalName: c.name,
        typeSlug: c.typeSlug!,
        officeCode,
        ...(c.pan ? { pan: c.pan } : {}),
        registrations: [
          ...c.newGstins.map((gstin, i) => ({
            registrationType: 'gstin' as const,
            registrationNumber: gstin,
            stateCode: gstin.slice(0, 2),
            isPrincipal: i === 0,
            source: 'client' as const,
          })),
          ...tanRegistration,
        ],
        contacts:
          c.email || c.phone
            ? [
                {
                  fullName: c.name,
                  ...(c.email ? { email: c.email } : {}),
                  ...(c.phone ? { phone: c.phone } : {}),
                  isPrimary: true,
                  contactType: 'tax',
                },
              ]
            : [],
      });
      entityId = detail.id;
      tally.registrationsAdded = c.newGstins.length + tanRegistration.length;
    } else {
      if (c.rename) {
        const before = await client.query<{ legal_name: string }>(
          `SELECT legal_name FROM hsdg.entities WHERE id = $1`,
          [entityId],
        );
        await client.query(
          `UPDATE hsdg.entities SET legal_name = $2, version = version + 1 WHERE id = $1`,
          [entityId, c.rename],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'entity.updated',
          objectType: 'entity',
          objectId: entityId!,
          before: { legalName: before.rows[0]?.legal_name },
          after: { legalName: c.rename },
        });
        notes.push(`"${before.rows[0]?.legal_name}" renamed "${c.rename}", as the sheet has it.`);
      }
      for (const gstin of c.newGstins) {
        await this.entities.addRegistrationWith(client, ctx, entityId!, {
          registrationType: 'gstin',
          registrationNumber: gstin,
          stateCode: gstin.slice(0, 2),
          isPrincipal: false,
          source: 'client',
        });
        tally.registrationsAdded += 1;
      }
      if (c.newTan) {
        await this.entities.addRegistrationWith(client, ctx, entityId!, tanRegistration[0]!);
        tally.registrationsAdded += 1;
      }
      if (c.email) {
        const known = await client.query(
          `SELECT 1 FROM hsdg.entity_contacts WHERE entity_id = $1 AND lower(email) = lower($2)`,
          [entityId, c.email],
        );
        if (known.rowCount === 0)
          await this.entities.addContactWith(client, ctx, entityId!, {
            fullName: c.name,
            email: c.email,
            ...(c.phone ? { phone: c.phone } : {}),
            isPrimary: false,
            contactType: 'tax',
          });
      }
    }

    const { rows: regs } = await client.query<{
      id: string;
      registration_type: string;
      registration_number: string;
    }>(
      `SELECT id, registration_type, registration_number FROM hsdg.entity_registrations
        WHERE entity_id = $1 AND registration_type IN ('gstin', 'tan')`,
      [entityId],
    );
    const regOf = new Map(regs.map((r) => [r.registration_number, r.id]));

    for (const l of c.logins) {
      const registrationId = l.gstin
        ? (regOf.get(l.gstin) ?? null)
        : l.tan && (l.account === 'tan' || l.account === 'deductor')
          ? (regOf.get(l.tan) ?? null)
          : null;
      await this.credentials.saveWith(client, ctx, {
        entityId: entityId!,
        registrationId,
        portal: l.portal,
        account: l.account,
        stateCode: l.stateCode,
        pendingFrequency: l.frequency,
        username: l.username,
        password: l.password,
      });
      tally.loginsSaved += 1;
    }

    // Each GSTIN's frequency, as its first scheme (an existing one is kept).
    for (const g of c.gst) {
      if (!g.gstin || !g.frequency) continue;
      const wanted = SCHEME[g.frequency];
      const kept = await this.step(client, async () => {
        const { rows } = await client.query<{ kept: string | null }>(
          `SELECT hsdg.set_initial_gst_scheme($1, $2) AS kept`,
          [regOf.get(g.gstin!), wanted],
        );
        return rows[0]!.kept;
      });
      if (kept === undefined) notes.push(`${g.gstin}: not allowed to set its GST scheme.`);
      else if (kept === null) tally.schemesSet += 1;
      else if (kept !== wanted)
        notes.push(
          `${g.gstin} is ${FREQUENCY_OF[kept] ?? kept} in the portal and ${FREQUENCY_OF[wanted]} in the sheet; the portal's is kept.`,
        );
    }

    await this.recordMarks(client, ctx, req.filename, entityId!, c, regOf, tally);
    await this.applyMarks(client, ctx, c, regOf, tally);
    return tally;
  }

  /**
   * The sheet's filed / NA marks, kept as the client's GST return history:
   * per GSTIN, or per state (or the client) while the sheet has no GSTIN.
   * A mark recorded by state before the GSTIN came moves onto the GSTIN.
   */
  private async recordMarks(
    client: PoolClient,
    ctx: RlsContext,
    filename: string,
    entityId: string,
    c: PlannedClient,
    regOf: Map<string, string>,
    tally: Tally,
  ): Promise<void> {
    for (const g of c.gst) {
      if (g.marks.length === 0) continue;
      const registrationId = g.gstin ? (regOf.get(g.gstin) ?? null) : null;
      const stateCode = g.gstin ? g.gstin.slice(0, 2) : g.stateCode;
      if (registrationId)
        await client.query(
          `DELETE FROM hsdg.client_return_marks
            WHERE entity_id = $1 AND registration_id IS NULL AND state_code = $2`,
          [entityId, stateCode],
        );
      // One mark per form and period: a later column wins.
      const marks = new Map(g.marks.map((m) => [`${m.form}|${m.period}`, m]));
      const res = await client.query(
        `INSERT INTO hsdg.client_return_marks AS m
           (entity_id, registration_id, state_code, return_form, period_key, mark,
            source_file, source_sheet, source_row, imported_by_user_id)
         SELECT $1::uuid, $2::uuid, $3::text, f.form, f.period, f.mark,
                $7::text, $8::text, $9::int, $10::uuid
           FROM unnest($4::text[], $5::text[], $6::text[]) AS f (form, period, mark)
         ON CONFLICT (entity_id, (COALESCE(registration_id::text, state_code, '')),
                      return_form, period_key)
         DO UPDATE SET mark = EXCLUDED.mark, source_file = EXCLUDED.source_file,
                       source_sheet = EXCLUDED.source_sheet, source_row = EXCLUDED.source_row,
                       imported_by_user_id = EXCLUDED.imported_by_user_id
          WHERE m.mark IS DISTINCT FROM EXCLUDED.mark`,
        [
          entityId,
          registrationId,
          stateCode,
          [...marks.values()].map((m) => m.form),
          [...marks.values()].map((m) => m.period),
          [...marks.values()].map((m) => m.mark),
          filename.slice(0, 200),
          g.sheet.trim().slice(0, 100),
          g.row,
          ctx.userId,
        ],
      );
      tally.marksRecorded += res.rowCount ?? 0;
    }
  }

  /** filed / NA marks → the matching open GSTR-1 / 3B / 7 filings, where the importer leads. */
  private async applyMarks(
    client: PoolClient,
    ctx: RlsContext,
    c: PlannedClient,
    regOf: Map<string, string>,
    tally: Tally,
  ): Promise<void> {
    const marked = c.gst.filter((g) => g.gstin && g.marks.length);
    if (marked.length === 0) return;
    const registrationIds = marked.map((g) => regOf.get(g.gstin!)!);
    const codes = Object.values(RULES_OF_FORM).flat();
    const periods = [
      ...new Set(marked.flatMap((g) => g.marks.flatMap((m) => periodKeysOfMark(m.period)))),
    ];
    const { rows } = await client.query<{
      id: string;
      registration_id: string;
      code: string;
      period_key: string;
      status: string;
      workflow_status: string | null;
      lead: boolean;
    }>(
      `SELECT ci.id, ci.registration_id, r.code, ci.period_key, ci.status, ci.workflow_status,
              hsdg.is_engagement_lead(ci.engagement_id) AS lead
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
        WHERE ci.registration_id = ANY($1::uuid[]) AND r.code = ANY($2::text[])
          AND ci.period_key = ANY($3::text[])`,
      [registrationIds, codes, periods],
    );
    const done = new Set<string>();

    for (const g of marked) {
      const registrationId = regOf.get(g.gstin!);
      for (const m of g.marks) {
        // A quarter's mark ('2026-27:Q1') is its quarter-end already.
        const quarterEnd = m.period.includes(':') || Number(m.period.slice(5)) % 3 === 0;
        // A quarterly GSTIN's other months have no GSTR-1 / 3B to mark (IFF, NA).
        if (g.frequency === 'quarterly' && !quarterEnd && m.form !== 'GSTR7') continue;
        const keys = periodKeysOfMark(m.period);
        const filing = rows.find(
          (r) =>
            r.registration_id === registrationId &&
            RULES_OF_FORM[m.form].includes(r.code) &&
            keys.includes(r.period_key),
        );
        if (!filing) {
          tally.marksWithoutFiling += 1;
          continue;
        }
        if (
          done.has(filing.id) ||
          filing.status !== 'open' ||
          filing.workflow_status === 'filed' ||
          filing.workflow_status === 'not_applicable'
        ) {
          tally.marksAlreadyDone += 1;
          continue;
        }
        if (!filing.lead) {
          tally.marksNotAllowed += 1;
          continue;
        }
        const filed = m.mark === 'filed';
        const reason = `Marked ${filed ? 'filed' : 'NA'} in the firm's GST sheet (${g.sheet.trim()}, row ${g.row}).`;
        const res = await client.query(
          filed
            ? `UPDATE hsdg.compliance_instances
                  SET status = 'completed', completed_at = now(), completed_by_employee_id = $2,
                      version = version + 1
                WHERE id = $1 AND status = 'open'`
            : `UPDATE hsdg.compliance_instances
                  SET status = 'waived', notes = $2, version = version + 1
                WHERE id = $1 AND status = 'open'`,
          [filing.id, filed ? (ctx.employeeId ?? null) : reason],
        );
        if (!res.rowCount) {
          tally.marksNotAllowed += 1;
          continue;
        }
        await client.query(`SELECT hsdg.refresh_instance_workflow_status($1)`, [filing.id]);
        await this.audit.recordWith(client, ctx, {
          action: filed ? 'compliance.instance_completed' : 'compliance.instance_waived',
          objectType: 'compliance_instance',
          objectId: filing.id,
          before: { status: 'open' },
          after: { status: filed ? 'completed' : 'waived' },
          reason,
        });
        done.add(filing.id);
        tally.marksApplied += 1;
      }
    }
  }

  /** Runs one optional step; a database refusal rolls back only that step (undefined). */
  private async step<T>(client: PoolClient, work: () => Promise<T>): Promise<T | undefined> {
    await client.query('SAVEPOINT import_step');
    try {
      const out = await work();
      await client.query('RELEASE SAVEPOINT import_step');
      return out;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT import_step');
      if ((err as { code?: string }).code === '42501') return undefined;
      throw err;
    }
  }

  /** Reads the file and decides each client's action against what the caller can see. */
  private async plan(ctx: RlsContext, req: ClientImportRequest): Promise<Plan> {
    const bytes = Buffer.from(req.contentBase64, 'base64');
    if (bytes.length === 0) throw new BadRequestException('The file is empty.');
    let book: ParsedWorkbook;
    try {
      book = parseClientWorkbook(bytes);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (book.gst.length + book.tds.length > MAX_ROWS)
      throw new BadRequestException(`At most ${MAX_ROWS} rows can be imported at once.`);
    const clients = clientsOfWorkbook(book, req.defaultTypeSlug ?? null);

    const lookups = await this.db.withRlsContext(ctx, async (client) => {
      const office = await client.query(`SELECT 1 FROM hsdg.offices WHERE code = $1`, [
        req.officeCode,
      ]);
      if (office.rowCount === 0)
        throw new BadRequestException(`Unknown office "${req.officeCode}".`);
      const types = await client.query<{ slug: string }>(`SELECT slug FROM hsdg.entity_types`);
      const slugs = new Set(types.rows.map((t) => t.slug));
      if (req.defaultTypeSlug && !slugs.has(req.defaultTypeSlug))
        throw new BadRequestException(`Unknown client type "${req.defaultTypeSlug}".`);

      const gstins = clients.flatMap((c) => c.gst.flatMap((g) => (g.gstin ? [g.gstin] : [])));
      const tans = clients.flatMap((c) => (c.tan ? [c.tan] : []));
      const regs = await client.query<{
        registration_number: string;
        entity_id: string;
      }>(
        `SELECT registration_number, entity_id FROM hsdg.entity_registrations
          WHERE (registration_type = 'gstin' AND registration_number = ANY($1::text[]))
             OR (registration_type = 'tan' AND registration_number = ANY($2::text[]))`,
        [gstins, tans],
      );
      // Every client one can see: the sheet's are matched by name, or a similar one.
      const entities = await client.query<{
        id: string;
        entity_code: string;
        legal_name: string;
        pan: string | null;
      }>(
        `SELECT id, entity_code, legal_name, pan FROM hsdg.entities
          WHERE status <> 'archived' OR id = ANY($1::uuid[])
          ORDER BY legal_name LIMIT 50000`,
        [[...new Set(regs.rows.map((r) => r.entity_id))]],
      );
      // The shown part of each GST login ('ab•••yz'): with the first word, a likely duplicate.
      const hints = await client.query<{ entity_id: string; username_hint: string }>(
        `SELECT entity_id, username_hint FROM hsdg.client_credentials WHERE portal = 'gst'`,
      );
      return { slugs, regs: regs.rows, entities: entities.rows, hints: hints.rows };
    });

    const regEntity = new Map(lookups.regs.map((r) => [r.registration_number, r.entity_id]));
    const entityById = new Map(lookups.entities.map((e) => [e.id, e]));

    const planned = clients.map((c): PlannedClient => {
      const base: PlannedClient = {
        ...c,
        action: CLIENT_IMPORT_ACTION.error,
        entityId: null,
        entityName: null,
        newGstins: c.gst.flatMap((g) => (g.gstin && !regEntity.has(g.gstin) ? [g.gstin] : [])),
        newTan: Boolean(c.tan && !regEntity.has(c.tan)),
        matchedBy: null,
        rename: null,
      };
      if (c.error) return base;
      const error = (message: string): PlannedClient => ({ ...base, error: message });

      // The portal's client: by PAN, a GSTIN or the TAN; else by name.
      const ids = new Set<string>();
      for (const e of lookups.entities) if (c.pan && e.pan === c.pan) ids.add(e.id);
      for (const g of c.gst)
        if (g.gstin && regEntity.has(g.gstin)) ids.add(regEntity.get(g.gstin)!);
      if (c.tan && regEntity.has(c.tan)) ids.add(regEntity.get(c.tan)!);
      let matchedBy: PlannedClient['matchedBy'] = ids.size ? 'key' : null;
      if (ids.size === 0) {
        const fits = (e: { pan: string | null }): boolean => !e.pan || !c.pan || e.pan === c.pan;
        const named = lookups.entities.filter(
          (e) => nameKey(e.legal_name) === nameKey(c.name) && fits(e),
        );
        if (named.length > 1)
          return error(
            `${named.length} clients in the portal are called "${c.name}"; add the PAN or GSTIN to the sheet.`,
          );
        const like = named.length
          ? named
          : lookups.entities.filter((e) => fits(e) && similarNames(e.legal_name, c.name));
        if (like.length > 1)
          return error(
            `"${c.name}" could be ${like.map((e) => `"${e.legal_name}"`).join(' or ')} in the portal; write the name as it is there, or add the PAN or GSTIN.`,
          );
        if (like[0]) {
          ids.add(like[0].id);
          matchedBy = named.length ? 'name' : 'similar';
        }
      }
      if (ids.size > 1)
        return error(
          `The sheet puts together what are ${ids.size} different clients in the portal (${[...ids]
            .map((id) => entityById.get(id)?.legal_name ?? 'one you cannot see')
            .join(', ')}).`,
        );

      const [id] = [...ids];
      if (id) {
        const entity = entityById.get(id);
        if (!entity) return error('A GSTIN or TAN in the sheet is on a client you cannot see.');
        if (c.pan && entity.pan && entity.pan !== c.pan)
          return error(`"${entity.legal_name}" in the portal has PAN ${entity.pan}, not ${c.pan}.`);
        const warnings = [...c.warnings];
        if (matchedBy === 'similar')
          warnings.push(`Taken to be "${entity.legal_name}" in the portal, by its name.`);
        const rename = fullerName(c.name, entity.legal_name);
        if (rename) warnings.push(`"${entity.legal_name}" will be renamed "${rename}".`);
        if (c.pan && !entity.pan)
          warnings.push(
            `"${entity.legal_name}" has no PAN in the portal; add ${c.pan} on the client page.`,
          );
        const anything =
          base.newGstins.length > 0 ||
          base.newTan ||
          c.logins.length > 0 ||
          c.gst.some((g) => g.marks.length > 0 || (g.gstin && g.frequency)) ||
          Boolean(c.email) ||
          Boolean(rename);
        return {
          ...base,
          matchedBy,
          rename,
          warnings,
          action: anything ? CLIENT_IMPORT_ACTION.updateClient : CLIENT_IMPORT_ACTION.unchanged,
          entityId: id,
          entityName: entity.legal_name,
        };
      }
      if (!c.typeSlug)
        return error(
          'The kind of client is not clear from the PAN or the name; choose a type for such clients above.',
        );
      if (!lookups.slugs.has(c.typeSlug)) return error(`Unknown client type "${c.typeSlug}".`);
      return { ...base, action: CLIENT_IMPORT_ACTION.createClient };
    });
    const hintsOf = new Map<string, Set<string>>();
    for (const h of lookups.hints)
      hintsOf.set(h.entity_id, (hintsOf.get(h.entity_id) ?? new Set()).add(h.username_hint));
    return { book, clients: crossCheck(planned, lookups.entities, hintsOf) };
  }
}

/** The preview never carries a login itself. */
function toPreviewRow(c: PlannedClient): ClientImportRow {
  const first = c.sources[0]!;
  return {
    key: c.key,
    source: sourceLabel(c.sources),
    sheet: first.sheet,
    row: first.row,
    name: c.name,
    pan: c.pan,
    tan: c.tan,
    email: c.email,
    typeSlug: c.typeSlug,
    typeGuessed: c.typeGuessed,
    gst: c.gst.map((g) => ({
      sheet: g.sheet,
      row: g.row,
      gstin: g.gstin,
      stateCode: g.stateCode,
      frequency: g.frequency,
      filed: g.marks.filter((m) => m.mark === 'filed').length,
      notApplicable: g.marks.filter((m) => m.mark === 'not_applicable').length,
    })),
    logins: c.logins.map(previewLogin),
    action: c.action,
    entityId: c.entityId,
    entityName: c.entityName,
    warnings: c.warnings,
    error: c.error,
  };
}

/**
 * Two sheet clients never take one portal client by name: the ones that did
 * are held back. And a portal client that no sheet row took (and has no other
 * PAN) is pointed out as a likely duplicate when its name is the same or
 * similar, or starts with the same word and it has a GST login that looks
 * like the sheet's.
 */
function crossCheck(
  planned: PlannedClient[],
  entities: { id: string; entity_code: string; legal_name: string; pan: string | null }[],
  hintsOf: Map<string, Set<string>>,
): PlannedClient[] {
  const takers = new Map<string, PlannedClient[]>();
  for (const c of planned)
    if (c.entityId) takers.set(c.entityId, [...(takers.get(c.entityId) ?? []), c]);
  const out = planned.map((c): PlannedClient => {
    const others = c.entityId ? takers.get(c.entityId)!.filter((o) => o !== c) : [];
    if (others.length && c.matchedBy !== 'key')
      return {
        ...c,
        action: CLIENT_IMPORT_ACTION.error,
        error: `"${c.entityName}" in the portal is also ${others.map((o) => `"${o.name}"`).join(', ')} in the sheet; write the name as it is in the portal, or add the PAN or GSTIN.`,
      };
    return c;
  });
  const taken = new Set(out.flatMap((c) => (c.entityId && !c.error ? [c.entityId] : [])));
  return out.map((c) => {
    if (c.error) return c;
    const twins = entities.filter(
      (e) =>
        e.id !== c.entityId &&
        !taken.has(e.id) &&
        (!e.pan || !c.pan || e.pan === c.pan) &&
        (nameKey(e.legal_name) === nameKey(c.name) ||
          similarNames(e.legal_name, c.name) ||
          (c.entityName !== null && nameKey(e.legal_name) === nameKey(c.entityName)) ||
          (sameFirstWord(e.legal_name, c.name) &&
            c.logins.some(
              (l) => l.portal === 'gst' && hintsOf.get(e.id)?.has(usernameHint(l.username)),
            ))),
    );
    return twins.length
      ? {
          ...c,
          warnings: [
            ...c.warnings,
            ...twins.map(
              (e) =>
                `"${e.legal_name}" (${e.entity_code}) in the portal looks like the same client; if it is, delete it.`,
            ),
          ],
        }
      : c;
  });
}
