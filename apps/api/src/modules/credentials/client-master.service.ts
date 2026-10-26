import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CLIENT_IMPORT_ACTION,
  CLIENT_MASTER_LOGIN_CELLS,
  CLIENT_MASTER_SAVED_PASSWORD,
  STREAMS,
  STREAM_LABEL,
  ENTITY_TYPE_SOURCE,
  credentialLabel,
  firmTypeFromIds,
  withCompanySuffix,
  type ClientImportAction,
  type EntityTypeSource,
  type ClientMasterChange,
  type ClientMasterEngagement,
  type ClientMasterPreview,
  type ClientMasterRequest,
  type ClientMasterResult,
  type ClientMasterRow,
  type CredentialAccount,
  type CredentialPortal,
  type Stream,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { EngagementKindsService } from '../engagements/engagement-kinds.service';
import { EngagementsService } from '../engagements/engagements.service';
import { EntitiesService } from '../entities/entities.service';
import type {
  AddressInput,
  ContactInput,
  RegistrationInput,
  UpdateEntityInput,
} from '../entities/entities.types';
import type { CredentialSecret } from './credential-cipher';
import { CredentialsService } from './credentials.service';
import {
  fillClientMaster,
  legalStatusLabel,
  parseClientMaster,
  type MasterExportClient,
  type MasterExportLogin,
  type MasterLogin,
  type MasterRow,
  type ParsedMaster,
} from './client-master';
import { nameKey, normalizeHeader } from './client-workbook';
import { officesOfOneBusiness, parseClientName, sameClient } from '../entities/client-names';

/** More rows than this is not a client list. */
const MAX_ROWS = 3000;
const SCHEME = { monthly: 'regular', quarterly: 'qrmp' } as const;
const FREQUENCY_OF: Record<string, string> = { regular: 'Monthly', qrmp: 'Quarterly' };
/** An engagement in one of these is over: the export shows no services for it. */
const ENDED = ['completed', 'closed', 'declined', 'withdrawn', 'cancelled', 'merged'];
const LLPIN_RE = /^[A-Z]{3}-[0-9]{4}$/;

// ── What the portal has ──────────────────────────────────────────────────

interface PortalEntity {
  id: string;
  entity_code: string;
  legal_name: string;
  trade_name: string | null;
  pan: string | null;
  type_slug: string | null;
  type_name: string | null;
  category: string | null;
  /** Where its type came from (CM-3): a 'manual' type is never changed by an import. */
  entity_type_source: EntityTypeSource;
  legal_status: string | null;
  incorporation_date: string | null;
  office_code: string | null;
  status: string;
  /** Set when it was merged into another client: its code then means the keeper. */
  merged_into_id: string | null;
}
interface PortalReg {
  id: string;
  entity_id: string;
  registration_type: string;
  registration_number: string;
  is_principal: boolean;
}
interface PortalContact {
  id: string;
  entity_id: string;
  full_name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}
interface PortalAddress {
  id: string;
  entity_id: string;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  is_primary: boolean;
}

interface Portal {
  types: { slug: string; name: string; category: string | null }[];
  entities: PortalEntity[];
  regs: PortalReg[];
  contacts: PortalContact[];
  addresses: PortalAddress[];
  /** registration id → its current GST scheme. */
  schemes: Map<string, string>;
}

const groupBy = <T>(items: T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const t of items) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return m;
};

/** A registration number as the sheet reads it: a stray dash, dot or space is a typing slip. */
const bareNumber = (n: string): string => n.replace(/[-.\s]/g, '').toUpperCase();

/** The one to show and fill: the primary, else the first. */
const primaryOf = <T extends { is_primary: boolean }>(items: T[] | undefined): T | undefined =>
  items?.find((i) => i.is_primary) ?? items?.[0];

/** The client's open Compliance engagement and its years. */
interface Cover {
  id: string;
  code: string;
  years: { financial_year: string; streams: Stream[]; status: string; version: number }[];
}

// ── A row, planned ───────────────────────────────────────────────────────

type ChildOp<I> = { add: I } | { fill: { id: string; patch: Record<string, string> } } | null;

interface Planned extends ClientMasterRow {
  src: MasterRow;
  typeSlug: string | null;
  /** Where typeSlug came from: the PAN, else the sheet (CM-3). */
  typeSource: EntityTypeSource;
  /** The legal name to save: the sheet's, with "Private Limited" added for a company (CM-5). */
  plannedName: string;
  officeCode: string;
  patch: UpdateEntityInput;
  newRegs: RegistrationInput[];
  contactOp: ChildOp<ContactInput>;
  addressOp: ChildOp<AddressInput>;
  /** GSTINs whose first monthly / quarterly scheme the row sets. */
  schemeGstins: string[];
  partnerId: string | null;
  leadId: string | null;
  loginRows: MasterLogin[];
}

interface Tally {
  fieldsFilled: number;
  registrationsAdded: number;
  contactsAdded: number;
  addressesAdded: number;
  loginsSaved: number;
  schemesSet: number;
  engagementsCreated: number;
  engagementsExtended: number;
}
const emptyTally = (): Tally => ({
  fieldsFilled: 0,
  registrationsAdded: 0,
  contactsAdded: 0,
  addressesAdded: 0,
  loginsSaved: 0,
  schemesSet: 0,
  engagementsCreated: 0,
  engagementsExtended: 0,
});

function failureMessage(err: unknown): string {
  const e = err as { code?: string };
  // A PAN / GSTIN on another client names that client (holderConflict).
  if (err instanceof HttpException) return err.message;
  if (e.code === '23505') return 'This PAN, GSTIN, TAN or CIN is already on another client.';
  return 'Could not be saved.';
}

interface ExportCredential {
  id: string;
  entity_id: string;
  portal: CredentialPortal;
  account: CredentialAccount;
  username_hint: string;
  registration_number: string | null;
}

export interface MasterExport {
  data: Buffer;
  filename: string;
  clients: number;
  /** Logins written in full / masked. Without passwords, every login is masked. */
  passwordsShown: number;
  passwordsMasked: number;
}

/**
 * Puts each client's logins in the workbook: the first of each kind on its
 * Clients row when it is for the client's main GSTIN / TAN (or has none),
 * every other on the Logins sheet. A login is written in full only when
 * `secrets` has it. Pure — tested through the export.
 */
function placeLogins(
  clients: MasterExportClient[],
  entities: PortalEntity[],
  regs: PortalReg[],
  creds: ExportCredential[],
  secrets: Map<string, CredentialSecret>,
): { logins: MasterExportLogin[]; shown: number; masked: number } {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const rowOf = new Map(clients.map((c) => [c.code as string, c]));
  const regsOf = groupBy(regs, (r) => r.entity_id);
  const logins: MasterExportLogin[] = [];
  let shown = 0;
  let masked = 0;
  for (const c of creds) {
    const e = byId.get(c.entity_id);
    const row = e && e.status !== 'archived' ? rowOf.get(e.entity_code) : undefined;
    if (!e || !row) continue;
    const secret = secrets.get(c.id);
    if (secret) shown += 1;
    else masked += 1;
    const username = secret?.username ?? c.username_hint;
    const password = secret?.password ?? CLIENT_MASTER_SAVED_PASSWORD;
    const cell = CLIENT_MASTER_LOGIN_CELLS.find(
      (k) => k.portal === c.portal && k.account === c.account,
    );
    if (cell && !row[cell.user]) {
      const own = regsOf.get(e.id) ?? [];
      const onGstin = c.portal === 'gst' || c.portal === 'eway_bill';
      const onTan = c.account === 'tan' || c.account === 'deductor';
      const main = onGstin ? row.gstin : onTan ? row.tan : null;
      const hasAny = own.some((r) => r.registration_type === (onGstin ? 'gstin' : 'tan'));
      const fits =
        !(onGstin || onTan) || (c.registration_number ? c.registration_number === main : !hasAny);
      if (fits) {
        row[cell.user] = username;
        row[cell.password] = password;
        continue;
      }
    }
    logins.push({
      code: e.entity_code,
      name: e.legal_name,
      portal: credentialLabel(c.portal, c.account),
      target: c.registration_number ?? '',
      username,
      password,
    });
  }
  return { logins, shown, masked };
}

const change = (
  field: string,
  from: string | null | undefined,
  to: string,
): ClientMasterChange => ({
  field,
  from: from || null,
  to,
});

let template: Buffer | null = null;
/** The template the export fills (copied into dist by nest-cli's assets). */
function clientMasterTemplate(): Buffer {
  template ??= readFileSync(join(__dirname, 'client-master-template.xlsx'));
  return template;
}

/**
 * The Client Master workbook: Export gives every client the caller can see
 * in the firm's template — its PAN, GSTINs, TAN, CIN, contact, address, GST
 * frequency, its open Compliance engagement's latest year and services, and
 * its logins (masked, or in full when asked and allowed) — so the gaps show;
 * Import reads it back.
 *
 * Import matches each row to a portal client by Client code, else its
 * GSTIN, PAN or TAN, else its exact name; a row with none is a new client.
 * An empty cell never wipes anything. A cell that differs changes the client
 * (name, type, dates, status) — except an identifier: a PAN is only filled
 * in, never replaced, and registrations are only added. A contact's or an
 * address's empty fields are filled. A financial year with services
 * creates the client's Compliance engagement, or adds the year or the
 * services to its open one. Logins — typed in a row's login columns or on
 * the Logins sheet — are sealed as the login import does.
 * Preview first; the import re-reads the same file, each row commits on its
 * own, and importing again only fills what is still missing.
 */
@Injectable()
export class ClientMasterService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    private readonly credentials: CredentialsService,
    private readonly engagements: EngagementsService,
    private readonly kinds: EngagementKindsService,
  ) {}

  // ── Export ─────────────────────────────────────────────────────────────

  /**
   * The workbook. Each client's main logins go on its row, the rest on the
   * Logins sheet — masked (the user ID's hint, "(saved in portal)"), or with
   * `passwords` in full for every client whose logins the caller may reveal.
   */
  async export(ctx: RlsContext, opts: { passwords?: boolean } = {}): Promise<MasterExport> {
    const { clients, creds, entities, regs, secrets } = await this.db.withRlsContext(
      ctx,
      async (client) => {
        const p = await this.portal(client);
        const covers = await client.query<{
          entity_id: string;
          financial_year: string;
          streams: Stream[];
          partner_email: string | null;
          lead_email: string | null;
        }>(
          `SELECT DISTINCT ON (e.entity_id) e.entity_id, y.financial_year, y.streams,
                pu.email::text AS partner_email,
                (SELECT lu.email::text FROM hsdg.engagement_services es
                   JOIN hsdg.employees le ON le.id = es.lead_employee_id
                   JOIN hsdg.users lu ON lu.id = le.user_id
                  WHERE es.engagement_id = e.id
                  ORDER BY es.is_primary DESC, es.created_at LIMIT 1) AS lead_email
           FROM hsdg.engagements e
           JOIN LATERAL (SELECT financial_year, streams FROM hsdg.compliance_engagement_years
                          WHERE engagement_id = e.id ORDER BY financial_year DESC LIMIT 1) y ON true
           LEFT JOIN hsdg.employees pe ON pe.id = e.engagement_partner_id
           LEFT JOIN hsdg.users pu ON pu.id = pe.user_id
          WHERE e.kind = 'compliance' AND e.status <> ALL($1::text[])
          ORDER BY e.entity_id, y.financial_year DESC`,
          [ENDED],
        );
        const creds = await client.query<ExportCredential>(
          `SELECT c.id, c.entity_id, c.portal, c.account, c.username_hint, r.registration_number
           FROM hsdg.client_credentials c
           LEFT JOIN hsdg.entity_registrations r ON r.id = c.registration_id
          ORDER BY c.portal, c.account, r.registration_number NULLS FIRST, c.created_at`,
        );
        const secrets = opts.passwords
          ? await this.credentials.openForExportWith(client)
          : new Map<string, CredentialSecret>();
        return {
          ...this.exportRows(p, covers.rows),
          creds: creds.rows,
          entities: p.entities,
          regs: p.regs,
          secrets,
        };
      },
    );
    const placed = placeLogins(clients, entities, regs, creds, secrets);

    const data = await fillClientMaster(clientMasterTemplate(), clients, placed.logins);
    await this.audit.record(ctx, {
      action: opts.passwords ? 'client_master.exported_with_passwords' : 'client_master.exported',
      objectType: 'client_import',
      after: {
        clients: clients.length,
        logins: placed.shown + placed.masked,
        ...(opts.passwords ? { passwordsShown: placed.shown, passwordsMasked: placed.masked } : {}),
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return {
      data,
      filename: `DHVAJ-Client-Master-${day}${opts.passwords ? '-with-passwords' : ''}.xlsx`,
      clients: clients.length,
      passwordsShown: placed.shown,
      passwordsMasked: placed.masked,
    };
  }

  private exportRows(
    p: Portal,
    covers: {
      entity_id: string;
      financial_year: string;
      streams: Stream[];
      partner_email: string | null;
      lead_email: string | null;
    }[],
  ): { clients: MasterExportClient[] } {
    const regsOf = groupBy(p.regs, (r) => r.entity_id);
    const contactsOf = groupBy(p.contacts, (c) => c.entity_id);
    const addressesOf = groupBy(p.addresses, (a) => a.entity_id);
    const coverOf = new Map(covers.map((c) => [c.entity_id, c]));
    const clients = p.entities
      .filter((e) => e.status !== 'archived')
      .map((e): MasterExportClient => {
        const regs = regsOf.get(e.id) ?? [];
        const gstins = regs
          .filter((r) => r.registration_type === 'gstin')
          .sort((a, b) => Number(b.is_principal) - Number(a.is_principal));
        const one = (type: string) => regs.find((r) => r.registration_type === type);
        const contact = primaryOf(contactsOf.get(e.id));
        const address = primaryOf(addressesOf.get(e.id));
        const cover = coverOf.get(e.id);
        const scheme = gstins[0] ? p.schemes.get(gstins[0].id) : undefined;
        const yes = (s: Stream) => (cover?.streams.includes(s) ? 'Yes' : null);
        return {
          code: e.entity_code,
          legalName: e.legal_name,
          tradeName: e.trade_name,
          entityType: e.type_name,
          pan: e.pan,
          gstin: gstins[0]?.registration_number,
          otherGstins: gstins
            .slice(1)
            .map((g) => g.registration_number)
            .join(', '),
          tan: one('tan')?.registration_number,
          cinLlpin: (one('cin') ?? one('llpin'))?.registration_number,
          incorporationDate: e.incorporation_date ? { date: e.incorporation_date } : null,
          legalStatus: e.legal_status ? legalStatusLabel(e.legal_status) : null,
          officeCode: e.office_code,
          contactName: contact?.full_name,
          designation: contact?.designation,
          email: contact?.email,
          mobile: contact?.phone,
          addressLine1: address?.line1,
          addressLine2: address?.line2,
          city: address?.city,
          state: address?.state,
          pincode: address?.pincode,
          financialYear: cover?.financial_year,
          gst: yes('gst'),
          gstFrequency: scheme ? FREQUENCY_OF[scheme] : null,
          tds: yes('tds'),
          incomeTax: yes('income_tax'),
          roc: yes('roc'),
          bookkeeping: yes('bookkeeping'),
          mis: yes('mis'),
          partnerEmail: cover?.partner_email,
          leadEmail: cover?.lead_email,
        };
      });
    return { clients };
  }

  /** Every client the caller can see, with its registrations, first contact and address. */
  private async portal(client: PoolClient): Promise<Portal> {
    const types = await client.query<Portal['types'][number]>(
      `SELECT slug, name, category FROM hsdg.entity_types ORDER BY name`,
    );
    const entities = await client.query<PortalEntity>(
      `SELECT e.id, e.entity_code, e.legal_name, e.trade_name, e.pan, et.slug AS type_slug,
              et.name AS type_name, et.category, e.entity_type_source, e.legal_status,
              e.incorporation_date::text AS incorporation_date, o.code AS office_code, e.status,
              e.merged_into_id
         FROM hsdg.entities e
         LEFT JOIN hsdg.entity_types et ON et.id = e.entity_type_id
         LEFT JOIN hsdg.offices o ON o.id = e.home_office_id
        ORDER BY e.legal_name LIMIT 50000`,
    );
    const regs = await client.query<PortalReg>(
      `SELECT id, entity_id, registration_type, registration_number, is_principal
         FROM hsdg.entity_registrations
        WHERE status IS DISTINCT FROM 'cancelled'
        ORDER BY created_at`,
    );
    const contacts = await client.query<PortalContact>(
      `SELECT id, entity_id, full_name, designation, email::text AS email, phone, is_primary
         FROM hsdg.entity_contacts ORDER BY created_at`,
    );
    const addresses = await client.query<PortalAddress>(
      `SELECT id, entity_id, line1, line2, city, state, pincode, is_primary
         FROM hsdg.entity_addresses ORDER BY created_at`,
    );
    const schemes = await client.query<{ registration_id: string; gst_scheme: string }>(
      `SELECT DISTINCT ON (registration_id) registration_id, gst_scheme
         FROM hsdg.registration_compliance_profiles
        WHERE registration_id IS NOT NULL AND gst_scheme IS NOT NULL
        ORDER BY registration_id, effective_from DESC`,
    );
    return {
      types: types.rows,
      entities: entities.rows,
      regs: regs.rows,
      contacts: contacts.rows,
      addresses: addresses.rows,
      schemes: new Map(schemes.rows.map((s) => [s.registration_id, s.gst_scheme])),
    };
  }

  // ── Preview / import ───────────────────────────────────────────────────

  async preview(ctx: RlsContext, req: ClientMasterRequest): Promise<ClientMasterPreview> {
    const { rows, loginProblems } = await this.plan(ctx, req);
    const counts = Object.fromEntries(
      Object.values(CLIENT_IMPORT_ACTION).map((a) => [a, 0]),
    ) as Record<ClientImportAction, number>;
    for (const r of rows) counts[r.action] += 1;
    const live = rows.filter((r) => r.action !== CLIENT_IMPORT_ACTION.error);
    return {
      rows: rows.map(toRow),
      counts,
      loginProblems,
      logins: live.reduce((n, r) => n + r.logins, 0),
      engagements: live.filter((r) => r.engagement && r.engagement.action !== 'existing').length,
      vaultReady: this.credentials.vaultReady,
    };
  }

  async import(ctx: RlsContext, req: ClientMasterRequest): Promise<ClientMasterResult> {
    const { rows } = await this.plan(ctx, req);
    const live = rows.filter(
      (r) => r.action !== CLIENT_IMPORT_ACTION.error && r.action !== CLIENT_IMPORT_ACTION.unchanged,
    );
    if (!this.credentials.vaultReady && live.some((r) => r.loginRows.length))
      throw new ServiceUnavailableException(
        'The file has logins but this server has no encryption key (CREDENTIALS_KEYS), so they cannot be saved. Ask the administrator to set it, or clear the login columns and the Logins sheet, then import again.',
      );

    const result: ClientMasterResult = {
      clientsCreated: 0,
      clientsUpdated: 0,
      unchanged: 0,
      ...emptyTally(),
      failed: [],
      notes: [],
    };
    for (const r of rows) {
      if (r.action === CLIENT_IMPORT_ACTION.error) {
        result.failed.push({ row: r.row, name: r.name, message: r.error ?? 'Error.' });
        continue;
      }
      if (r.action === CLIENT_IMPORT_ACTION.unchanged) {
        result.unchanged += 1;
        continue;
      }
      try {
        const notes: string[] = [];
        const tally = await this.db.withRlsContext(ctx, (client) =>
          this.apply(client, ctx, r, notes),
        );
        if (r.action === CLIENT_IMPORT_ACTION.createClient) result.clientsCreated += 1;
        else result.clientsUpdated += 1;
        for (const k of Object.keys(tally) as (keyof Tally)[]) result[k] += tally[k];
        for (const message of notes) result.notes.push({ row: r.row, name: r.name, message });
      } catch (err) {
        result.failed.push({ row: r.row, name: r.name, message: failureMessage(err) });
      }
    }

    await this.audit.record(ctx, {
      action: 'client_import.master',
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

  /** One row, in the caller's transaction. */
  private async apply(
    client: PoolClient,
    ctx: RlsContext,
    r: Planned,
    notes: string[],
  ): Promise<Tally> {
    const tally = emptyTally();
    let entityId = r.entityId;

    if (r.action === CLIENT_IMPORT_ACTION.createClient) {
      const add = <I>(op: ChildOp<I>): I[] => (op && 'add' in op ? [op.add] : []);
      const detail = await this.entities.createEntityWith(client, ctx, {
        legalName: r.plannedName || r.src.legalName,
        typeSlug: r.typeSlug!,
        entityTypeSource: r.typeSource,
        officeCode: r.officeCode,
        ...(r.src.tradeName ? { tradeName: r.src.tradeName } : {}),
        ...(r.src.pan ? { pan: r.src.pan } : {}),
        ...(r.src.incorporationDate ? { incorporationDate: r.src.incorporationDate } : {}),
        ...(r.src.legalStatus ? { legalStatus: r.src.legalStatus } : {}),
        registrations: r.newRegs,
        contacts: add(r.contactOp),
        addresses: add(r.addressOp),
      });
      entityId = detail.id;
      tally.registrationsAdded += r.newRegs.length;
      tally.contactsAdded += add(r.contactOp).length;
      tally.addressesAdded += add(r.addressOp).length;
    } else {
      if (Object.keys(r.patch).length) {
        await this.entities.updateEntityWith(client, ctx, entityId!, r.patch);
        tally.fieldsFilled += Object.keys(r.patch).length;
      }
      for (const reg of r.newRegs) {
        await this.entities.addRegistrationWith(client, ctx, entityId!, reg);
        tally.registrationsAdded += 1;
        if (reg.registrationType === 'gstin')
          await this.entities.officeForGstinWith(
            client,
            ctx,
            entityId!,
            reg.registrationNumber,
            r.src.legalName ? (parseClientName(r.src.legalName).place?.text ?? null) : null,
          );
      }
      for (const [kind, op] of [
        ['contact', r.contactOp],
        ['address', r.addressOp],
      ] as const) {
        if (!op) continue;
        if ('add' in op) {
          if (kind === 'contact')
            await this.entities.addContactWith(client, ctx, entityId!, op.add as ContactInput);
          else await this.entities.addAddressWith(client, ctx, entityId!, op.add as AddressInput);
          tally[kind === 'contact' ? 'contactsAdded' : 'addressesAdded'] += 1;
        } else {
          await this.entities.fillChildWith(
            client,
            ctx,
            entityId!,
            kind,
            op.fill.id,
            op.fill.patch,
          );
          tally.fieldsFilled += Object.keys(op.fill.patch).length;
        }
      }
    }

    const { rows: regs } = await client.query<{
      id: string;
      registration_type: string;
      registration_number: string;
      is_principal: boolean;
    }>(
      `SELECT id, registration_type, registration_number, is_principal
         FROM hsdg.entity_registrations
        WHERE entity_id = $1 AND registration_type IN ('gstin', 'tan')
        ORDER BY is_principal DESC, created_at`,
      [entityId],
    );
    const regOf = new Map(regs.map((g) => [g.registration_number, g.id]));

    // Each GSTIN's first scheme (an existing one is kept).
    const wanted = r.src.gstFrequency ? SCHEME[r.src.gstFrequency] : null;
    for (const gstin of wanted ? r.schemeGstins : []) {
      const kept = await this.step(client, async () => {
        const { rows } = await client.query<{ kept: string | null }>(
          `SELECT hsdg.set_initial_gst_scheme($1, $2) AS kept`,
          [regOf.get(gstin), wanted],
        );
        return rows[0]!.kept;
      });
      if (kept === undefined) notes.push(`${gstin}: not allowed to set its GST return frequency.`);
      else if (kept === null) tally.schemesSet += 1;
      else if (kept !== wanted)
        notes.push(
          `${gstin} is ${FREQUENCY_OF[kept] ?? kept} in the portal and ${FREQUENCY_OF[wanted!]} in the sheet; the portal's is kept.`,
        );
    }

    const mainOf = (type: string) =>
      regs.find((g) => g.registration_type === type)?.registration_number ?? null;
    for (const l of r.loginRows) {
      const gst = l.portal === 'gst';
      const onTan = l.account === 'tan' || l.account === 'deductor';
      const number = gst ? l.target || mainOf('gstin') : onTan ? l.target || mainOf('tan') : null;
      await this.credentials.saveWith(client, ctx, {
        entityId: entityId!,
        registrationId: number ? (regOf.get(number) ?? null) : null,
        portal: l.portal,
        account: l.account,
        stateCode: gst && number ? number.slice(0, 2) : null,
        pendingFrequency: gst ? (r.src.gstFrequency ?? null) : null,
        username: l.username,
        password: l.password,
      });
      tally.loginsSaved += 1;
    }

    if (r.engagement && r.engagement.action !== 'existing')
      await this.ensureEngagement(client, ctx, r, entityId!, tally, notes);
    return tally;
  }

  /**
   * The row's Compliance engagement: a new one (the row's partner, else the
   * importer, and its lead on every service), or the year or the services
   * added to the client's open one. A refusal (an independence rule, no
   * partner to lead it) is noted and the rest of the row stays imported.
   */
  private async ensureEngagement(
    client: PoolClient,
    ctx: RlsContext,
    r: Planned,
    entityId: string,
    tally: Tally,
    notes: string[],
  ): Promise<void> {
    const { financialYear: fy, streams } = r.engagement!;
    const leads = r.leadId ? Object.fromEntries(streams.map((s) => [s, r.leadId!])) : null;
    const services = streams.map((s) => STREAM_LABEL[s]).join(', ');
    await client.query('SAVEPOINT master_engagement');
    try {
      const cover = await this.cover(client, entityId);
      const year = cover?.years.find((y) => y.financial_year === fy);
      if (!cover) {
        const created = await this.engagements.createEngagementWith(client, ctx, {
          kind: 'compliance',
          entityId,
          financialYear: fy,
          status: 'accepted',
          streams,
          years: [{ financialYear: fy }],
          ...(r.partnerId ? { engagementPartnerEmployeeId: r.partnerId } : {}),
          ...(leads ? { streamLeads: leads } : {}),
        });
        tally.engagementsCreated += 1;
        notes.push(
          `Compliance engagement ${created.engagementCode} opened for ${fy}: ${services}.`,
        );
      } else if (!year) {
        await this.kinds.addYearWith(client, ctx, cover.id, { financialYear: fy, streams });
        tally.engagementsExtended += 1;
        notes.push(`${fy} added to ${cover.code}: ${services}.`);
      } else {
        const add = streams.filter((s) => !year.streams.includes(s));
        if (add.length) {
          await this.kinds.updateYearStreamsWith(client, ctx, cover.id, fy, {
            add,
            version: year.version,
            ...(leads ? { streamLeads: leads } : {}),
          });
          tally.engagementsExtended += 1;
          notes.push(
            `${add.map((s) => STREAM_LABEL[s]).join(', ')} added to ${cover.code} for ${fy}.`,
          );
        }
      }
      await client.query('RELEASE SAVEPOINT master_engagement');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT master_engagement');
      const why =
        err instanceof HttpException
          ? err.message
          : (err as { code?: string }).code === '42501'
            ? 'not allowed for you.'
            : 'it could not be saved.';
      notes.push(`No engagement for ${fy}: ${why}`);
    }
  }

  private async cover(client: PoolClient, entityId: string): Promise<Cover | null> {
    const kc = await this.kinds.kindContext(client, entityId);
    const open = this.kinds.openCompliance(kc.facts);
    if (!open) return null;
    const { rows } = await client.query<Cover['years'][number]>(
      `SELECT financial_year, streams, status, version FROM hsdg.compliance_engagement_years
        WHERE engagement_id = $1`,
      [open.id],
    );
    return { id: open.id, code: open.engagementCode, years: rows };
  }

  /** Runs one optional step; a database refusal rolls back only that step (undefined). */
  private async step<T>(client: PoolClient, work: () => Promise<T>): Promise<T | undefined> {
    await client.query('SAVEPOINT master_step');
    try {
      const out = await work();
      await client.query('RELEASE SAVEPOINT master_step');
      return out;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT master_step');
      if ((err as { code?: string }).code === '42501') return undefined;
      throw err;
    }
  }

  /** Reads the file and decides each row's action against what the caller can see. */
  private async plan(
    ctx: RlsContext,
    req: ClientMasterRequest,
  ): Promise<{ rows: Planned[]; loginProblems: ParsedMaster['loginProblems'] }> {
    const bytes = Buffer.from(req.contentBase64, 'base64');
    if (bytes.length === 0) throw new BadRequestException('The file is empty.');
    let parsed: ParsedMaster;
    try {
      parsed = parseClientMaster(bytes);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (parsed.rows.length > MAX_ROWS)
      throw new BadRequestException(`At most ${MAX_ROWS} clients can be imported at once.`);

    return this.db.withRlsContext(ctx, async (client) => {
      const offices = await client.query<{ code: string }>(`SELECT code FROM hsdg.offices`);
      const officeCodes = new Set(offices.rows.map((o) => o.code.toUpperCase()));
      if (!officeCodes.has(req.officeCode.toUpperCase()))
        throw new BadRequestException(`Unknown office "${req.officeCode}".`);
      const p = await this.portal(client);
      const emails = [
        ...new Set(parsed.rows.flatMap((r) => [r.partnerEmail, r.leadEmail]).filter(Boolean)),
      ];
      const people = await client.query<{ id: string; email: string }>(
        `SELECT emp.id, lower(u.email::text) AS email
           FROM hsdg.employees emp JOIN hsdg.users u ON u.id = emp.user_id
          WHERE lower(u.email::text) = ANY($1::text[])`,
        [emails],
      );
      const employeeOf = new Map(people.rows.map((e) => [e.email, e.id]));
      const planner = new RowPlanner(p, officeCodes, req.officeCode.toUpperCase(), employeeOf);
      const rows: Planned[] = [];
      for (const src of parsed.rows) {
        const planned = planner.plan(src);
        if (
          planned.entityId &&
          planned.engagement &&
          planned.action !== CLIENT_IMPORT_ACTION.error
        ) {
          const cover = await this.cover(client, planned.entityId);
          planned.engagement = engagementPlan(cover, planned.engagement);
        }
        rows.push(planned);
      }
      const loginProblems = attachLogins(rows, parsed, p);
      return { rows: rows.map(settleAction), loginProblems };
    });
  }
}

/** Create, add the year, add services, or nothing — against the open Compliance engagement. */
function engagementPlan(
  cover: Cover | null,
  wanted: ClientMasterEngagement,
): ClientMasterEngagement {
  if (!cover) return { ...wanted, action: 'create', engagementCode: null };
  const year = cover.years.find((y) => y.financial_year === wanted.financialYear);
  if (!year) return { ...wanted, action: 'add_year', engagementCode: cover.code };
  const add = wanted.streams.filter((s) => !year.streams.includes(s));
  return add.length
    ? { ...wanted, action: 'add_streams', engagementCode: cover.code, streams: add }
    : { ...wanted, action: 'existing', engagementCode: cover.code };
}

/**
 * Decides each row against the portal: which client it is, and what it
 * fills, adds or changes. Rows are planned in order so a later row that is
 * the same client as an earlier one is stopped.
 */
class RowPlanner {
  private readonly byCode: Map<string, PortalEntity>;
  private readonly byId: Map<string, PortalEntity>;
  private readonly regByNumber: Map<string, PortalReg>;
  private readonly regsOf: Map<string, PortalReg[]>;
  private readonly contactsOf: Map<string, PortalContact[]>;
  private readonly addressesOf: Map<string, PortalAddress[]>;
  /** Entity → the sheet row that took it. */
  private readonly taken = new Map<string, number>();
  /** A new client's PAN / GSTIN → its sheet row. */
  private readonly newKeys = new Map<string, number>();
  /** Live (not merged) clients by the first word of their name, for look-alikes. */
  private readonly byFirstWord: Map<string, PortalEntity[]>;

  constructor(
    private readonly p: Portal,
    private readonly officeCodes: Set<string>,
    private readonly defaultOffice: string,
    private readonly employeeOf: Map<string, string>,
  ) {
    this.byId = new Map(p.entities.map((e) => [e.id, e]));
    // A merged client's code still finds its client: the one it was merged into.
    this.byCode = new Map(
      p.entities.map((e) => [
        e.entity_code.toUpperCase(),
        (e.merged_into_id && this.byId.get(e.merged_into_id)) || e,
      ]),
    );
    this.byFirstWord = groupBy(
      p.entities.filter((e) => !e.merged_into_id),
      (e) => parseClientName(e.legal_name).words[0] ?? '',
    );
    this.regByNumber = new Map(p.regs.map((r) => [bareNumber(r.registration_number), r]));
    this.regsOf = groupBy(p.regs, (r) => r.entity_id);
    this.contactsOf = groupBy(p.contacts, (c) => c.entity_id);
    this.addressesOf = groupBy(p.addresses, (a) => a.entity_id);
  }

  private typeOf(raw: string): Portal['types'][number] | undefined {
    const key = normalizeHeader(raw);
    return this.p.types.find(
      (t) => normalizeHeader(t.name) === key || normalizeHeader(t.slug) === key,
    );
  }

  /**
   * A PAN, GSTIN or TAN that fails its check but is already on the row's
   * client (the export wrote what the portal has) does not stop the row:
   * it is left alone, with a warning.
   */
  private forgive(src: MasterRow): MasterRow {
    const e = src.code ? this.byCode.get(src.code) : undefined;
    if (!e || src.badIds.length === 0) return src;
    const regs = this.regsOf.get(e.id) ?? [];
    const on = (id: string) =>
      bareNumber(e.pan ?? '') === bareNumber(id) ||
      regs.some((r) => bareNumber(r.registration_number) === bareNumber(id));
    // A clash the portal already holds: its PAN and that GSTIN, both on the client.
    const held = (b: MasterRow['badIds'][number]) =>
      on(b.id) && (!b.clash || (!!src.pan && bareNumber(e.pan ?? '') === src.pan));
    if (!src.badIds.every(held)) return src;
    const bad = new Set(src.badIds.filter((b) => !b.clash).map((b) => b.id));
    return {
      ...src,
      gstins: src.gstins.filter((g) => !bad.has(g)),
      tan: bad.has(src.tan) ? '' : src.tan,
      badIds: [],
      error: src.errors.length ? src.errors.join(' ') : null,
      warnings: [
        ...src.warnings,
        ...[...bad].map(
          (id) => `${id} in the portal is not valid; check it on the client's page (left as is).`,
        ),
        ...src.badIds
          .filter((b) => b.clash)
          .map(
            (b) =>
              `${b.message} Both are on the client in the portal; check its page (left as is).`,
          ),
      ],
    };
  }

  plan(row: MasterRow): Planned {
    const src = this.forgive(row);
    const base: Planned = {
      row: src.row,
      name: src.legalName || `Row ${src.row}`,
      action: CLIENT_IMPORT_ACTION.error,
      entityId: null,
      entityCode: null,
      matchedBy: null,
      changes: [],
      engagement: null,
      logins: 0,
      warnings: [...src.warnings],
      error: src.error,
      src,
      typeSlug: null,
      typeSource: ENTITY_TYPE_SOURCE.import,
      plannedName: src.legalName,
      officeCode: src.officeCode || this.defaultOffice,
      patch: {},
      newRegs: [],
      contactOp: null,
      addressOp: null,
      schemeGstins: [],
      partnerId: null,
      leadId: null,
      loginRows: [],
      duplicate: null,
    };
    if (src.error) return base;
    const error = (message: string): Planned => ({ ...base, error: message });

    // Which portal client: by code, then GSTIN / PAN / TAN, then exact name.
    const found = new Map<string, Planned['matchedBy']>();
    const note = (id: string, by: Planned['matchedBy']) => {
      if (!found.has(id)) found.set(id, by);
    };
    if (src.code) {
      const e = this.byCode.get(src.code);
      if (!e) return error(`Client code ${src.code} is not in the portal, or not in your office.`);
      if (e.entity_code.toUpperCase() !== src.code)
        base.warnings.push(
          `${src.code} was merged into ${e.entity_code}; the row goes to ${e.entity_code}.`,
        );
      note(e.id, 'code');
    }
    for (const g of src.gstins) {
      const r = this.regByNumber.get(bareNumber(g));
      if (r) note(r.entity_id, 'gstin');
    }
    if (src.pan)
      for (const e of this.p.entities)
        if (e.pan === src.pan && !e.merged_into_id) note(e.id, 'pan');
    const tanReg = src.tan ? this.regByNumber.get(bareNumber(src.tan)) : undefined;
    if (tanReg) note(tanReg.entity_id, 'tan');
    if (found.size === 0) {
      const named = this.p.entities.filter(
        (e) =>
          !e.merged_into_id &&
          nameKey(e.legal_name) === nameKey(src.legalName) &&
          (!e.pan || !src.pan),
      );
      if (named.length > 1)
        return error(
          `${named.length} clients in the portal are called "${src.legalName}"; put the Client code in the row.`,
        );
      if (named[0]) note(named[0].id, 'name');
    }
    if (found.size === 2) {
      const [a, b] = [...found.keys()].map((k) => this.byId.get(k));
      if (a && b) return this.twoClients(base, a, b);
    }
    if (found.size > 1)
      return error(
        `The row's code, GSTIN, PAN or TAN are on ${found.size} different clients in the portal (${[
          ...found.keys(),
        ]
          .map((id) => this.byId.get(id)?.legal_name ?? 'one you cannot see')
          .join(', ')}).`,
      );

    const [[id, matchedBy] = [null, null]] = [...found];
    if (id) {
      const e = this.byId.get(id);
      if (!e) return error('A GSTIN or TAN in the row is on a client you cannot see.');
      const earlier = this.taken.get(id);
      if (earlier) return error(`Row ${earlier} is already this client (${e.entity_code}).`);
      this.taken.set(id, src.row);
      return this.update(base, e, matchedBy);
    }
    for (const key of [src.pan, ...src.gstins].filter(Boolean)) {
      const earlier = this.newKeys.get(key);
      if (earlier)
        return error(`Row ${earlier} has the same ${key.length === 10 ? 'PAN' : 'GSTIN'} ${key}.`);
    }
    for (const key of [src.pan, ...src.gstins].filter(Boolean)) this.newKeys.set(key, src.row);
    return this.create({ ...base, warnings: [...base.warnings, ...this.lookAlikes(src)] });
  }

  /**
   * The row's code, GSTIN, PAN or TAN lead to two portal clients. When the
   * two are one legal entity (a shared PAN, or names that agree) the person
   * is offered the merge; the row imports once they are one.
   */
  private twoClients(base: Planned, a: PortalEntity, b: PortalEntity): Planned {
    const ids = (e: PortalEntity) => ({
      name: e.legal_name,
      pan: e.pan,
      gstins: (this.regsOf.get(e.id) ?? [])
        .filter((r) => r.registration_type === 'gstin')
        .map((r) => r.registration_number),
    });
    const { verdict, reasons } = sameClient(ids(a), ids(b));
    const both = `${a.entity_code} ${a.legal_name} and ${b.entity_code} ${b.legal_name}`;
    if (verdict === 'different')
      return {
        ...base,
        error: `The row's code, GSTIN, PAN or TAN are on two different clients (${both}). ${reasons[0]}`,
      };
    return {
      ...base,
      error: `The row's code, GSTIN, PAN or TAN are on ${both}, which look like one client entered twice. Merge them, then preview again.`,
      duplicate: {
        entityIds: [a.id, b.id],
        entityCodes: [a.entity_code, b.entity_code],
        verdict,
        reasons,
      },
    };
  }

  /** A new client that looks like one already in the portal: say which, so it is not added twice. */
  private lookAlikes(src: MasterRow): string[] {
    const first = parseClientName(src.legalName).words[0];
    if (!first) return [];
    const out: string[] = [];
    for (const e of this.byFirstWord.get(first) ?? []) {
      const row = { name: src.legalName, pan: src.pan, gstins: src.gstins };
      const portal = { name: e.legal_name, pan: e.pan };
      if (officesOfOneBusiness(row, portal))
        out.push(
          `Looks like an office of ${e.entity_code} ${e.legal_name}; to add it as that client's office, put ${e.entity_code} in the Client code column.`,
        );
      else if (['probable', 'possible'].includes(sameClient(row, portal).verdict))
        out.push(
          `Looks like ${e.entity_code} ${e.legal_name} in the portal; if it is that client, put ${e.entity_code} in the Client code column.`,
        );
      if (out.length === 2) break;
    }
    return out;
  }

  private create(base: Planned): Planned {
    const { src } = base;
    const typed = src.entityType ? this.typeOf(src.entityType) : undefined;
    // The PAN (or a GSTIN's 6th letter) decides the type, whatever the sheet says (CM-3).
    const fromPan = firmTypeFromIds({
      pan: src.pan,
      gstins: src.gstins,
      nameOrTypedType: `${src.legalName} ${src.entityType}`,
      hasBusinessRegistration: src.gstins.length > 0,
    });
    if (src.entityType && !typed && !fromPan)
      return { ...base, error: `Entity type "${src.entityType}" is not one of the list.` };
    const typeSlug = fromPan?.slug ?? typed?.slug ?? null;
    if (!typeSlug)
      return {
        ...base,
        error: 'Entity type is missing and no PAN or GSTIN says it: pick one in the row.',
      };
    if (!this.officeCodes.has(base.officeCode))
      return { ...base, error: `Home office code "${base.officeCode}" is not an office.` };
    const type = this.p.types.find((t) => t.slug === typeSlug);
    const warnings = [...base.warnings];

    const changes: ClientMasterChange[] = [
      change('Client', null, `New, in office ${base.officeCode}`),
    ];
    if (fromPan && type && typed && typed.slug !== fromPan.slug)
      changes.push(
        change('Firm type', `Sheet said ${typed.name}`, `${type.name} (${fromPan.reason})`),
      );
    else if (fromPan && type && !typed)
      changes.push(change('Firm type', null, `${type.name} (${fromPan.reason})`));
    const plannedName = withCompanySuffix(src.legalName, typeSlug);
    if (plannedName !== src.legalName)
      changes.push(change('Name', src.legalName, `${plannedName} (company PAN)`));
    if (src.pan) changes.push(change('PAN', null, src.pan));
    const newRegs = this.newRegistrations(src, [], changes, warnings);
    const contactOp: ChildOp<ContactInput> = src.contact
      ? { add: this.contactInput(src, true) }
      : null;
    if (src.contact) changes.push(change('Contact', null, contactLine(src)));
    const addressOp: ChildOp<AddressInput> = src.address
      ? { add: { addressType: 'registered', ...addressInput(src), isPrimary: true } }
      : null;
    if (src.address) changes.push(change('Address', null, addressLine(src)));
    const gstins = src.gstins;
    if (src.gstFrequency && gstins.length)
      changes.push(change('GST return frequency', null, FREQUENCY_OF[SCHEME[src.gstFrequency]]!));
    const planned: Planned = {
      ...base,
      action: CLIENT_IMPORT_ACTION.createClient,
      typeSlug,
      typeSource: fromPan ? ENTITY_TYPE_SOURCE.pan : ENTITY_TYPE_SOURCE.import,
      plannedName,
      changes,
      newRegs,
      contactOp,
      addressOp,
      schemeGstins: src.gstFrequency ? gstins : [],
      warnings,
    };
    return this.withEngagement(planned, type?.category ?? null, gstins, src.tan);
  }

  private update(base: Planned, e: PortalEntity, matchedBy: Planned['matchedBy']): Planned {
    const { src } = base;
    const warnings = [...base.warnings];
    if (matchedBy === 'name')
      warnings.push(
        `Taken to be ${e.entity_code} in the portal by its name; put the Client code in the row to be sure.`,
      );
    if (src.pan && e.pan && src.pan !== e.pan)
      return {
        ...base,
        entityId: e.id,
        entityCode: e.entity_code,
        matchedBy,
        error: `${e.entity_code} has PAN ${e.pan} in the portal, not ${src.pan}.`,
      };

    const changes: ClientMasterChange[] = [];
    const patch: UpdateEntityInput = {};
    if (src.legalName && src.legalName !== e.legal_name) {
      const sheet = parseClientName(src.legalName);
      const portal = parseClientName(e.legal_name);
      // "3Aces Technologies - Delhi" for "3Aces Technologies": the sheet
      // names the office's registration, not a new name.
      if (sheet.key === portal.key && sheet.form === portal.form && sheet.place && !portal.place)
        warnings.push(
          `The sheet's name adds a place (${sheet.place.text}); the portal's name "${e.legal_name}" is kept.`,
        );
      else {
        patch.legalName = src.legalName;
        changes.push(change('Legal name', e.legal_name, src.legalName));
      }
    }
    if (src.tradeName && src.tradeName !== (e.trade_name ?? '')) {
      patch.tradeName = src.tradeName;
      changes.push(change('Trade name', e.trade_name, src.tradeName));
    }
    let category = e.category;
    const typed = src.entityType ? this.typeOf(src.entityType) : undefined;
    if (src.entityType && !typed)
      warnings.push(`Entity type "${src.entityType}" is not one of the list; kept as is.`);
    const portalGstinNumbers = (this.regsOf.get(e.id) ?? [])
      .filter((r) => r.registration_type === 'gstin')
      .map((r) => r.registration_number);
    // PAN beats the sheet; a type set by hand in the portal beats both (CM-3).
    const fromPan = firmTypeFromIds({
      pan: src.pan || e.pan,
      gstins: [...src.gstins, ...portalGstinNumbers],
      nameOrTypedType: `${src.legalName || e.legal_name} ${src.entityType}`,
      hasBusinessRegistration: src.gstins.length + portalGstinNumbers.length > 0,
    });
    const wanted = fromPan?.slug ?? typed?.slug;
    if (wanted && wanted !== e.type_slug) {
      const t = this.p.types.find((x) => x.slug === wanted);
      if (e.entity_type_source === ENTITY_TYPE_SOURCE.manual)
        warnings.push(
          `Firm type ${e.type_name} was set by hand in the portal; it is kept (the ${fromPan ? 'PAN' : 'sheet'} says ${t?.name ?? wanted}).`,
        );
      else if (t) {
        patch.typeSlug = t.slug;
        patch.entityTypeSource = fromPan ? ENTITY_TYPE_SOURCE.pan : ENTITY_TYPE_SOURCE.import;
        category = t.category;
        changes.push(
          change(
            'Firm type',
            typed && fromPan && typed.slug !== fromPan.slug
              ? `${e.type_name ?? '—'} (sheet said ${typed.name})`
              : e.type_name,
            fromPan ? `${t.name} (${fromPan.reason})` : t.name,
          ),
        );
      }
    }
    // "Private Limited" on a company's name, proposed so it is seen before the import (CM-5).
    const finalType = patch.typeSlug ?? e.type_slug;
    const nameNow = patch.legalName ?? e.legal_name;
    const suffixed = withCompanySuffix(nameNow, finalType);
    if (suffixed === e.legal_name && patch.legalName !== undefined) {
      // The sheet only dropped the suffix the portal's name already has.
      delete patch.legalName;
      const at = changes.findIndex((c) => c.field === 'Legal name');
      if (at >= 0) changes.splice(at, 1);
    } else if (suffixed !== nameNow) {
      patch.legalName = suffixed;
      changes.push(change('Name', nameNow, `${suffixed} (company PAN)`));
    }
    if (src.pan && !e.pan) {
      patch.pan = src.pan;
      changes.push(change('PAN', null, src.pan));
    }
    if (src.incorporationDate && src.incorporationDate !== e.incorporation_date) {
      patch.incorporationDate = src.incorporationDate;
      changes.push(change('Date of incorporation', e.incorporation_date, src.incorporationDate));
    }
    if (src.legalStatus && src.legalStatus !== e.legal_status) {
      patch.legalStatus = src.legalStatus;
      changes.push(
        change(
          'Legal status',
          e.legal_status ? legalStatusLabel(e.legal_status) : null,
          legalStatusLabel(src.legalStatus),
        ),
      );
    }

    const regs = this.regsOf.get(e.id) ?? [];
    const newRegs = this.newRegistrations(src, regs, changes, warnings);
    const contactOp = this.contactPlan(src, e.id, changes);
    const addressOp = this.addressPlan(src, e.id, changes, warnings);

    // GST frequency: the GSTINs (the row's, else the portal's) without one yet.
    const portalGstins = regs.filter((r) => r.registration_type === 'gstin');
    const gstins = [...new Set([...src.gstins, ...portalGstins.map((r) => r.registration_number)])];
    const schemeGstins: string[] = [];
    if (src.gstFrequency) {
      const wanted = SCHEME[src.gstFrequency];
      for (const g of src.gstins.length ? src.gstins : gstins) {
        const reg = this.regByNumber.get(bareNumber(g));
        const has = reg ? this.p.schemes.get(reg.id) : undefined;
        if (!has) schemeGstins.push(g);
        else if (has !== wanted)
          warnings.push(
            `${g} is ${FREQUENCY_OF[has]} in the portal, ${FREQUENCY_OF[wanted]} in the sheet; the portal's is kept (change it on the client's GST profile).`,
          );
      }
      if (schemeGstins.length)
        changes.push(change('GST return frequency', null, FREQUENCY_OF[wanted]!));
    }

    const tan =
      src.tan || regs.find((r) => r.registration_type === 'tan')?.registration_number || '';
    const planned: Planned = {
      ...base,
      action: CLIENT_IMPORT_ACTION.updateClient,
      entityId: e.id,
      entityCode: e.entity_code,
      matchedBy,
      typeSlug: patch.typeSlug ?? e.type_slug,
      typeSource: patch.entityTypeSource ?? e.entity_type_source,
      plannedName: patch.legalName ?? e.legal_name,
      changes,
      patch,
      newRegs,
      contactOp,
      addressOp,
      schemeGstins,
      warnings,
    };
    return this.withEngagement(planned, category, gstins, tan);
  }

  /** The row's GSTINs, TAN and CIN / LLPIN the client does not have yet. */
  private newRegistrations(
    src: MasterRow,
    regs: PortalReg[],
    changes: ClientMasterChange[],
    warnings: string[],
  ): RegistrationInput[] {
    const has = (n: string) =>
      regs.some((r) => bareNumber(r.registration_number) === bareNumber(n));
    const ofType = (t: string) => regs.filter((r) => r.registration_type === t);
    const out: RegistrationInput[] = [];
    let principal = ofType('gstin').length === 0;
    for (const g of src.gstins) {
      if (has(g)) continue;
      out.push({
        registrationType: 'gstin',
        registrationNumber: g,
        stateCode: g.slice(0, 2),
        isPrincipal: principal,
        source: 'client',
      });
      principal = false;
      const states = new Set(ofType('gstin').map((r) => r.registration_number.slice(0, 2)));
      changes.push(
        change(
          'GSTIN',
          null,
          states.size && !states.has(g.slice(0, 2))
            ? `${g} (another state: an office of this client)`
            : g,
        ),
      );
    }
    if (src.tan && !has(src.tan)) {
      const other = ofType('tan')[0];
      if (other)
        warnings.push(
          `The portal has TAN ${other.registration_number}; ${src.tan} not added (add it on the client page if it is a second TAN).`,
        );
      else {
        out.push({ registrationType: 'tan', registrationNumber: src.tan, source: 'client' });
        changes.push(change('TAN', null, src.tan));
      }
    }
    if (src.cinLlpin && !has(src.cinLlpin)) {
      const type = LLPIN_RE.test(src.cinLlpin) ? 'llpin' : 'cin';
      const other = ofType(type)[0];
      if (other)
        warnings.push(
          `The portal has ${type.toUpperCase()} ${other.registration_number}; ${src.cinLlpin} not added.`,
        );
      else {
        out.push({ registrationType: type, registrationNumber: src.cinLlpin, source: 'client' });
        changes.push(change(type.toUpperCase(), null, src.cinLlpin));
      }
    }
    return out;
  }

  private contactInput(src: MasterRow, isPrimary: boolean): ContactInput {
    const c = src.contact!;
    return {
      fullName: c.fullName,
      ...(c.designation ? { designation: c.designation } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
      isPrimary,
    };
  }

  /** A new contact, or the same person's empty fields filled. */
  private contactPlan(
    src: MasterRow,
    entityId: string,
    changes: ClientMasterChange[],
  ): ChildOp<ContactInput> {
    const c = src.contact;
    if (!c) return null;
    const contacts = this.contactsOf.get(entityId) ?? [];
    const same = contacts.find(
      (x) =>
        (c.email && x.email?.toLowerCase() === c.email) ||
        nameKey(x.full_name) === nameKey(c.fullName),
    );
    if (!same) {
      changes.push(change('Contact', null, contactLine(src)));
      return { add: this.contactInput(src, !contacts.some((x) => x.is_primary)) };
    }
    const patch: Record<string, string> = {};
    if (c.designation && !same.designation) patch.designation = c.designation;
    if (c.email && !same.email) patch.email = c.email;
    if (c.phone && !same.phone) patch.phone = c.phone;
    const label: Record<string, string> = {
      designation: 'designation',
      email: 'e-mail',
      phone: 'mobile',
    };
    for (const [k, v] of Object.entries(patch))
      changes.push(change(`${same.full_name}'s ${label[k]}`, null, v));
    return Object.keys(patch).length ? { fill: { id: same.id, patch } } : null;
  }

  /** The address when the client has none; else the same address's empty fields. */
  private addressPlan(
    src: MasterRow,
    entityId: string,
    changes: ClientMasterChange[],
    warnings: string[],
  ): ChildOp<AddressInput> {
    const a = src.address;
    if (!a) return null;
    const current = primaryOf(this.addressesOf.get(entityId));
    if (!current) {
      changes.push(change('Address', null, addressLine(src)));
      return { add: { addressType: 'registered', ...addressInput(src), isPrimary: true } };
    }
    if (nameKey(current.line1) !== nameKey(a.line1)) {
      warnings.push(`The portal has another address ("${current.line1}"); it is kept.`);
      return null;
    }
    const patch: Record<string, string> = {};
    if (a.line2 && !current.line2) patch.line2 = a.line2;
    if (a.city && !current.city) patch.city = a.city;
    if (a.state && !current.state) patch.state = a.state;
    if (a.pincode && !current.pincode) patch.pincode = a.pincode;
    for (const [k, v] of Object.entries(patch)) changes.push(change(`Address ${k}`, null, v));
    return Object.keys(patch).length ? { fill: { id: current.id, patch } } : null;
  }

  /** The services the row asks for that the client can have, with who leads them. */
  private withEngagement(
    planned: Planned,
    category: string | null,
    gstins: string[],
    tan: string,
  ): Planned {
    const { src } = planned;
    if (!src.financialYear || src.streams.length === 0) return planned;
    const warnings = [...planned.warnings];
    const streams = STREAMS.filter((s) => {
      if (!src.streams.includes(s)) return false;
      if (s === 'gst' && gstins.length === 0) {
        warnings.push('GST left out of the engagement: the client has no GSTIN.');
        return false;
      }
      if (s === 'tds' && !tan) {
        warnings.push('TDS / TCS left out of the engagement: the client has no TAN.');
        return false;
      }
      if (s === 'roc' && category !== 'company' && category !== 'llp') {
        warnings.push('ROC / MCA left out: it is only for a company or an LLP.');
        return false;
      }
      return true;
    });
    const person = (email: string, label: string): string | null => {
      if (!email) return null;
      const id = this.employeeOf.get(email);
      if (!id) warnings.push(`${label} ${email} is not a portal user; left out.`);
      return id ?? null;
    };
    return {
      ...planned,
      warnings,
      partnerId: person(src.partnerEmail, 'Engagement partner'),
      leadId: person(src.leadEmail, 'Lead'),
      engagement: streams.length
        ? { action: 'create', engagementCode: null, financialYear: src.financialYear, streams }
        : null,
    };
  }
}

const contactLine = (src: MasterRow): string =>
  [src.contact!.fullName, src.contact!.designation, src.contact!.email, src.contact!.phone]
    .filter(Boolean)
    .join(' · ');
const addressLine = (src: MasterRow): string =>
  [
    src.address!.line1,
    src.address!.line2,
    src.address!.city,
    src.address!.state,
    src.address!.pincode,
  ]
    .filter(Boolean)
    .join(', ');
function addressInput(src: MasterRow): Omit<AddressInput, 'addressType' | 'isPrimary'> {
  const a = src.address!;
  return {
    line1: a.line1,
    ...(a.line2 ? { line2: a.line2 } : {}),
    ...(a.city ? { city: a.city } : {}),
    ...(a.state ? { state: a.state } : {}),
    ...(a.pincode ? { pincode: a.pincode } : {}),
  };
}

/**
 * Ties each Logins row to its Clients row (by Client code, else the legal
 * name) and checks the GSTIN / TAN it is for is the client's. Returns the
 * rows that could not be tied.
 */
function attachLogins(
  rows: Planned[],
  parsed: ParsedMaster,
  p: Portal,
): ParsedMaster['loginProblems'] {
  const problems = [...parsed.loginProblems];
  const byCode = new Map<string, Planned>();
  const byName = groupBy(rows, (r) => nameKey(r.src.legalName));
  for (const r of rows) {
    if (r.src.code) byCode.set(r.src.code, r);
    if (r.entityCode) byCode.set(r.entityCode.toUpperCase(), r);
  }
  const regsOf = groupBy(p.regs, (r) => r.entity_id);
  const byRow = new Map(rows.map((r) => [r.row, r]));
  for (const l of parsed.logins) {
    // Typed on the client's own row: that row, whatever its code or name.
    if (l.clientRow !== null) {
      const own = byRow.get(l.clientRow);
      if (own) {
        own.loginRows.push(l);
        own.logins += 1;
      }
      continue;
    }
    const named = l.name ? (byName.get(nameKey(l.name)) ?? []) : [];
    const r =
      (l.code && byCode.get(l.code.toUpperCase())) || (named.length === 1 ? named[0] : null);
    if (!r) {
      problems.push({
        row: l.row,
        message:
          named.length > 1
            ? `More than one row on Clients is "${l.name}"; put the Client code.`
            : `No row on Clients is "${l.code || l.name}".`,
      });
      continue;
    }
    if (l.target && (l.portal === 'gst' || l.account === 'tan' || l.account === 'deductor')) {
      const own = [
        ...r.src.gstins,
        r.src.tan,
        ...(r.entityId ? (regsOf.get(r.entityId) ?? []).map((g) => g.registration_number) : []),
      ];
      if (!own.includes(l.target)) {
        problems.push({ row: l.row, message: `${l.target} is not ${r.name}'s GSTIN or TAN.` });
        continue;
      }
    }
    r.loginRows.push(l);
    r.logins += 1;
  }
  return problems;
}

/** An update that changes nothing is "already here". */
function settleAction(r: Planned): Planned {
  if (r.error) return { ...r, action: CLIENT_IMPORT_ACTION.error };
  if (
    r.action === CLIENT_IMPORT_ACTION.updateClient &&
    r.changes.length === 0 &&
    r.loginRows.length === 0 &&
    (!r.engagement || r.engagement.action === 'existing')
  )
    return { ...r, action: CLIENT_IMPORT_ACTION.unchanged };
  return r;
}

function toRow(r: Planned): ClientMasterRow {
  return {
    row: r.row,
    name: r.name,
    action: r.action,
    entityId: r.entityId,
    entityCode: r.entityCode,
    matchedBy: r.matchedBy,
    changes: r.changes,
    engagement: r.engagement,
    logins: r.logins,
    warnings: r.warnings,
    error: r.error,
    duplicate: r.duplicate,
  };
}
