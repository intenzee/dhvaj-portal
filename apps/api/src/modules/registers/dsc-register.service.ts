import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CREDENTIAL_SHOW_SECONDS,
  DSC_AT_RISK_DAYS,
  dscEffectiveStatus,
  type CheckInDscInput,
  type CheckOutDscInput,
  type CreateDscTokenInput,
  type DscClass,
  type DscListResponse,
  type DscMovement,
  type DscMovementKind,
  type DscStatus,
  type DscToken,
  type DscTokenDetail,
  type DscUsage,
  type DscView,
  type ReleaseDscInput,
  type RevealedDscPin,
  type UpdateDscTokenInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import { CredentialsService } from '../credentials/credentials.service';
import { istToday } from '../engagements/time/auto-time';

const STALE = 'Someone changed this token since you opened it. Reload and try again.';
const NOT_FOUND = 'DSC token not found.';
const PIN_NEEDS_CLIENT =
  'Link the token to its client first: the PIN is kept with the client’s logins.';

export interface DscListQuery {
  search?: string;
  view?: DscView;
  entityId?: string;
  officeId?: string;
  id?: string;
  limit?: number;
  offset?: number;
}

interface TokenRow {
  id: string;
  office_id: string;
  office_name: string | null;
  holder_name: string;
  holder_pan: string | null;
  din: string | null;
  entity_id: string | null;
  entity_name: string | null;
  class: DscClass;
  usage: DscUsage;
  issuer: string | null;
  valid_from: string | null;
  valid_to: string;
  days_to_expiry: number;
  token_serial: string | null;
  in_office: boolean;
  location: string | null;
  out_with_employee_id: string | null;
  out_with_name: string | null;
  out_since: Date | null;
  expected_back_at: Date | null;
  overdue_return: boolean;
  status: DscStatus;
  status_reason: string | null;
  notes: string | null;
  has_pin: boolean;
  version: number;
  total?: string;
}

/** `$1` is IST today. Visible tokens only (RLS). */
const TOKEN_SELECT = `
  SELECT t.id, t.office_id, o.name AS office_name, t.holder_name, t.holder_pan, t.din,
         t.entity_id, ent.legal_name AS entity_name, t.class, t.usage, t.issuer,
         t.valid_from::text, t.valid_to::text, (t.valid_to - $1::date) AS days_to_expiry,
         t.token_serial, t.in_office, t.location, t.out_with_employee_id,
         COALESCE(ow.full_name, t.out_with_name) AS out_with_name, t.out_since,
         t.expected_back_at,
         (NOT t.in_office AND t.status = 'active' AND t.expected_back_at < now()) AS overdue_return,
         t.status, t.status_reason, t.notes,
         EXISTS (SELECT 1 FROM hsdg.client_credentials c WHERE c.dsc_token_id = t.id) AS has_pin,
         t.version, count(*) OVER () AS total
    FROM hsdg.dsc_tokens t
    LEFT JOIN hsdg.offices o ON o.id = t.office_id
    LEFT JOIN hsdg.entities ent ON ent.id = t.entity_id
    LEFT JOIN hsdg.employees ow ON ow.id = t.out_with_employee_id`;

/** The "at risk" condition: expiring within DSC_AT_RISK_DAYS, or out past its return. */
export const DSC_AT_RISK_SQL = `t.status = 'active'
  AND (t.valid_to <= $1::date + ${DSC_AT_RISK_DAYS}
       OR (NOT t.in_office AND t.expected_back_at < now()))`;

const VIEW_SQL: Record<DscView, string> = {
  all: `t.status IN ('active', 'expired')`,
  at_risk: DSC_AT_RISK_SQL,
  out: `t.status = 'active' AND NOT t.in_office`,
  expiring: `t.status = 'active' AND t.valid_to <= $1::date + ${DSC_AT_RISK_DAYS}`,
  gone: `t.status IN ('returned_to_holder', 'lost')`,
};

export function tokenOf(r: TokenRow, today: string): DscToken {
  return {
    id: r.id,
    officeId: r.office_id,
    officeName: r.office_name,
    holderName: r.holder_name,
    holderPan: r.holder_pan,
    din: r.din,
    entityId: r.entity_id,
    entityName: r.entity_name,
    class: r.class,
    usage: r.usage,
    issuer: r.issuer,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    daysToExpiry: Number(r.days_to_expiry),
    tokenSerial: r.token_serial,
    inOffice: r.in_office,
    location: r.location,
    outWithEmployeeId: r.out_with_employee_id,
    outWithName: r.out_with_name,
    outSince: r.out_since ? r.out_since.toISOString() : null,
    expectedBackAt: r.expected_back_at ? r.expected_back_at.toISOString() : null,
    overdueReturn: r.overdue_return,
    status: dscEffectiveStatus(r.status, r.valid_to, today),
    statusReason: r.status_reason,
    notes: r.notes,
    hasPin: r.has_pin,
    version: r.version,
    link: { engagementId: '', engagementKind: 'compliance', dscId: r.id },
  };
}

/** The end of an IST day, as an instant: a token due back "on" a day is due by its close. */
export function endOfIstDay(date: string): string {
  return `${date}T23:59:59+05:30`;
}

/**
 * PS-305: the latest expiry the register knows for each DIN (active tokens
 * the caller can see). The ROC profile's dscExpiresOn yields to it.
 */
export async function dscExpiryByDin(
  client: PoolClient,
  dins: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(dins.filter((d) => /^\d{8}$/.test(d)))];
  if (wanted.length === 0) return new Map();
  const { rows } = await client.query<{ din: string; valid_to: string }>(
    `SELECT din, max(valid_to)::text AS valid_to FROM hsdg.dsc_tokens
      WHERE din = ANY($1::text[]) AND status = 'active'
      GROUP BY din`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.din, r.valid_to]));
}

/** Directors with the register's expiry where it has a token for the DIN. */
export async function withRegisterDscExpiry<T extends { din: string; dscExpiresOn?: string }>(
  client: PoolClient,
  directors: readonly T[],
): Promise<T[]> {
  const byDin = await dscExpiryByDin(
    client,
    directors.map((d) => d.din),
  );
  return directors.map((d) => (byDin.has(d.din) ? { ...d, dscExpiresOn: byDin.get(d.din)! } : d));
}

/**
 * Practice Services PS-305 — the DSC register and custody. Reads follow the
 * token's office or its client (RLS); keeping the register (adding a token,
 * its details, returning or losing it) needs register.manage, and checking a
 * token out or in needs engagement.read or register.manage (the controller).
 * The PIN lives in the logins vault (ADR-0035) and is revealed only there.
 */
@Injectable()
export class DscRegisterService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly credentials: CredentialsService,
  ) {}

  async list(ctx: RlsContext, query: DscListQuery, canManage: boolean): Promise<DscListResponse> {
    const today = istToday();
    return this.db.withRlsContext(ctx, async (client) => {
      const args: unknown[] = [today];
      const arg = (v: unknown) => {
        args.push(v);
        return `$${args.length}`;
      };
      const where: string[] = [];
      if (query.id) where.push(`t.id = ${arg(query.id)}`);
      else where.push(`(${VIEW_SQL[query.view ?? 'all']})`);
      if (query.entityId) where.push(`t.entity_id = ${arg(query.entityId)}`);
      if (query.officeId) where.push(`t.office_id = ${arg(query.officeId)}`);
      const search = query.search?.trim();
      if (search) {
        const p = arg(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where.push(
          `(t.holder_name ILIKE ${p} OR t.holder_pan ILIKE ${p} OR t.din ILIKE ${p}
            OR t.token_serial ILIKE ${p} OR ent.legal_name ILIKE ${p})`,
        );
      }
      const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
      const offset = Math.max(query.offset ?? 0, 0);
      const { rows } = await client.query<TokenRow>(
        `${TOKEN_SELECT}
          WHERE ${where.join(' AND ')}
          ORDER BY t.valid_to, t.holder_name
          LIMIT ${arg(limit)} OFFSET ${arg(offset)}`,
        args,
      );
      return {
        items: rows.map((r) => tokenOf(r, today)),
        total: Number(rows[0]?.total ?? 0),
        canManage,
      };
    });
  }

  async get(ctx: RlsContext, id: string): Promise<DscTokenDetail> {
    return this.db.withRlsContext(ctx, (client) => this.detail(client, id));
  }

  async create(ctx: RlsContext, input: CreateDscTokenInput): Promise<DscTokenDetail> {
    checkDates(input.validFrom ?? null, input.validTo);
    if (input.pin && !input.entityId) throw new BadRequestException(PIN_NEEDS_CLIENT);
    return this.db.withRlsContext(ctx, async (client) => {
      const officeId =
        input.officeId ?? (await this.officeFor(client, ctx, input.entityId ?? null));
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.dsc_tokens
             (office_id, holder_name, holder_pan, din, entity_id, class, usage, issuer,
              valid_from, valid_to, token_serial, location, notes, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            officeId,
            input.holderName.trim(),
            upperOrNull(input.holderPan),
            trimOrNull(input.din),
            input.entityId ?? null,
            input.class ?? 'class3',
            input.usage ?? 'sign',
            trimOrNull(input.issuer),
            input.validFrom ?? null,
            input.validTo,
            trimOrNull(input.tokenSerial),
            trimOrNull(input.location),
            trimOrNull(input.notes),
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err, {
          check: 'The token is not valid. Check the PAN, the DIN and the dates.',
          forbidden: 'You can add tokens only for your own office, or for a client you can see.',
          foreignKey: 'The client or office was not found.',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'dsc.added',
        objectType: 'dsc_token',
        objectId: id,
        after: {
          holderName: input.holderName.trim(),
          entityId: input.entityId ?? null,
          validTo: input.validTo,
        },
      });
      if (input.pin) {
        await this.credentials.saveDscPinWith(client, ctx, {
          tokenId: id,
          entityId: input.entityId!,
          holderName: input.holderName,
          pin: input.pin,
        });
      }
      return this.detail(client, id);
    });
  }

  async update(ctx: RlsContext, id: string, input: UpdateDscTokenInput): Promise<DscTokenDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const cur = await this.lock(client, id, input.version);
      const sets: string[] = [];
      const args: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        args.push(v);
        sets.push(`${col} = $${args.length}`);
      };
      if (input.holderName !== undefined) set('holder_name', input.holderName.trim());
      if (input.holderPan !== undefined) set('holder_pan', upperOrNull(input.holderPan));
      if (input.din !== undefined) set('din', trimOrNull(input.din));
      if (input.entityId !== undefined) set('entity_id', input.entityId);
      if (input.class !== undefined) set('class', input.class);
      if (input.usage !== undefined) set('usage', input.usage);
      if (input.issuer !== undefined) set('issuer', trimOrNull(input.issuer));
      if (input.validFrom !== undefined) set('valid_from', input.validFrom);
      if (input.validTo !== undefined) set('valid_to', input.validTo);
      if (input.tokenSerial !== undefined) set('token_serial', trimOrNull(input.tokenSerial));
      if (input.location !== undefined) set('location', trimOrNull(input.location));
      if (input.notes !== undefined) set('notes', trimOrNull(input.notes));
      if (sets.length === 0) return this.detail(client, id);
      checkDates(
        input.validFrom !== undefined ? input.validFrom : cur.valid_from,
        input.validTo ?? cur.valid_to,
      );
      if (input.entityId !== undefined && input.entityId !== cur.entity_id && cur.has_pin) {
        throw new BadRequestException(
          'This token’s PIN is kept with its client. Forget the PIN before moving it to another client.',
        );
      }
      try {
        await client.query(
          `UPDATE hsdg.dsc_tokens SET ${sets.join(', ')}, version = version + 1 WHERE id = $1`,
          args,
        );
      } catch (err) {
        throw translatePgError(err, {
          check: 'The token is not valid. Check the PAN, the DIN and the dates.',
          forbidden: 'You can move a token only to a client you can see.',
          foreignKey: 'The client was not found.',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'dsc.updated',
        objectType: 'dsc_token',
        objectId: id,
        before: { validTo: cur.valid_to, entityId: cur.entity_id },
        after: { ...input, version: undefined },
      });
      return this.detail(client, id);
    });
  }

  async checkOut(ctx: RlsContext, id: string, input: CheckOutDscInput): Promise<DscTokenDetail> {
    const purpose = input.purpose?.trim();
    if (!purpose) throw new BadRequestException('Say what the token is taken out for.');
    const withName = input.withName?.trim() || null;
    if (!input.withEmployeeId && !withName)
      throw new BadRequestException('Say who takes the token: a colleague, or a name.');
    if (input.expectedBackOn < istToday())
      throw new BadRequestException('The day it is due back can’t be in the past.');
    return this.db.withRlsContext(ctx, async (client) => {
      const cur = await this.lock(client, id, input.version);
      if (cur.status !== 'active')
        throw new ConflictException('This token has left the register; it can’t be taken out.');
      if (!cur.in_office)
        throw new ConflictException('This token is already out. Check it in first.');
      const backAt = endOfIstDay(input.expectedBackOn);
      await client.query(
        `UPDATE hsdg.dsc_tokens
            SET in_office = false, out_with_employee_id = $2, out_with_name = $3,
                out_since = now(), expected_back_at = $4, version = version + 1
          WHERE id = $1`,
        [id, input.withEmployeeId ?? null, input.withEmployeeId ? null : withName, backAt],
      );
      await this.move(client, ctx, id, 'out', {
        withEmployeeId: input.withEmployeeId ?? null,
        withName: input.withEmployeeId ? null : withName,
        purpose,
        expectedBackAt: backAt,
      });
      return this.detail(client, id);
    });
  }

  async checkIn(ctx: RlsContext, id: string, input: CheckInDscInput): Promise<DscTokenDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const cur = await this.lock(client, id, input.version);
      if (cur.in_office) throw new ConflictException('This token is already in the office.');
      if (cur.status !== 'active')
        throw new ConflictException('This token has left the register; it can’t be checked in.');
      await client.query(
        `UPDATE hsdg.dsc_tokens
            SET in_office = true, out_with_employee_id = NULL, out_with_name = NULL,
                out_since = NULL, expected_back_at = NULL,
                location = COALESCE($2, location), version = version + 1
          WHERE id = $1`,
        [id, trimOrNull(input.location)],
      );
      await this.move(client, ctx, id, 'in', {});
      return this.detail(client, id);
    });
  }

  /** Returned to its holder, or lost: it leaves the register (kept, with the reason). */
  async release(ctx: RlsContext, id: string, input: ReleaseDscInput): Promise<DscTokenDetail> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Say why the token leaves the register.');
    return this.db.withRlsContext(ctx, async (client) => {
      const cur = await this.lock(client, id, input.version);
      if (cur.status !== 'active' && cur.status !== 'expired')
        throw new ConflictException('This token has already left the register.');
      const returned = input.status === 'returned_to_holder';
      await client.query(
        `UPDATE hsdg.dsc_tokens
            SET status = $2, status_reason = $3, in_office = false,
                out_with_employee_id = NULL,
                out_with_name = CASE WHEN $4 THEN holder_name END,
                out_since = COALESCE(out_since, now()), expected_back_at = NULL,
                version = version + 1
          WHERE id = $1`,
        [id, input.status, reason, returned],
      );
      if (returned) await this.move(client, ctx, id, 'returned_to_holder', { purpose: reason });
      await this.audit.recordWith(client, ctx, {
        action: returned ? 'dsc.returned_to_holder' : 'dsc.lost',
        objectType: 'dsc_token',
        objectId: id,
        after: { reason },
      });
      // A token the firm no longer holds needs no PIN in the vault.
      await this.credentials.removeDscPinWith(client, ctx, id);
      return this.detail(client, id);
    });
  }

  async setPin(ctx: RlsContext, id: string, pin: string): Promise<DscTokenDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const cur = await this.read(client, id);
      if (!cur.entity_id) throw new BadRequestException(PIN_NEEDS_CLIENT);
      if (cur.status === 'returned_to_holder' || cur.status === 'lost')
        throw new ConflictException('This token has left the register; it needs no PIN.');
      await this.credentials.saveDscPinWith(client, ctx, {
        tokenId: id,
        entityId: cur.entity_id,
        holderName: cur.holder_name,
        pin,
      });
      return this.detail(client, id);
    });
  }

  /** The PIN, once, through the vault's reveal (its checks, rate limit and log). */
  async revealPin(ctx: RlsContext, id: string): Promise<RevealedDscPin> {
    const credentialId = await this.db.withRlsContext(ctx, async (client) => {
      await this.read(client, id);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.client_credentials WHERE portal = 'dsc' AND dsc_token_id = $1`,
        [id],
      );
      return rows[0]?.id ?? null;
    });
    if (!credentialId)
      throw new NotFoundException(
        'No PIN is kept for this token, or only the client’s partner and team can see it.',
      );
    const secret = await this.credentials.reveal(ctx, credentialId);
    return { pin: secret.password, showSeconds: CREDENTIAL_SHOW_SECONDS };
  }

  private async move(
    client: PoolClient,
    ctx: RlsContext,
    tokenId: string,
    kind: DscMovementKind,
    m: {
      withEmployeeId?: string | null;
      withName?: string | null;
      purpose?: string | null;
      expectedBackAt?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.dsc_movements
         (token_id, kind, by_employee_id, with_employee_id, with_name, purpose, expected_back_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tokenId,
        kind,
        ctx.employeeId ?? null,
        m.withEmployeeId ?? null,
        m.withName ?? null,
        m.purpose ?? null,
        m.expectedBackAt ?? null,
      ],
    );
    await this.audit.recordWith(client, ctx, {
      action: `dsc.${kind === 'out' ? 'checked_out' : kind === 'in' ? 'checked_in' : 'returned'}`,
      objectType: 'dsc_token',
      objectId: tokenId,
      after: m,
    });
  }

  private async read(
    client: PoolClient,
    id: string,
  ): Promise<{
    entity_id: string | null;
    holder_name: string;
    status: DscStatus;
    in_office: boolean;
    valid_from: string | null;
    valid_to: string;
    version: number;
    has_pin: boolean;
  }> {
    const { rows } = await client.query(
      `SELECT t.entity_id, t.holder_name, t.status, t.in_office, t.valid_from::text,
              t.valid_to::text, t.version,
              EXISTS (SELECT 1 FROM hsdg.client_credentials c WHERE c.dsc_token_id = t.id) AS has_pin
         FROM hsdg.dsc_tokens t WHERE t.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException(NOT_FOUND);
    return rows[0];
  }

  private async lock(client: PoolClient, id: string, version: number) {
    const cur = await this.read(client, id);
    const { rows } = await client.query<{ version: number }>(
      `SELECT version FROM hsdg.dsc_tokens WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException(NOT_FOUND);
    if (rows[0].version !== version) throw new ConflictException(STALE);
    return cur;
  }

  /** A new token's office: its client's home office, else the caller's. */
  private async officeFor(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string | null,
  ): Promise<string> {
    if (entityId) {
      const { rows } = await client.query<{ home_office_id: string | null }>(
        `SELECT home_office_id FROM hsdg.entities WHERE id = $1`,
        [entityId],
      );
      if (!rows[0]) throw new NotFoundException('Client not found.');
      if (rows[0].home_office_id) return rows[0].home_office_id;
    }
    if (ctx.officeId) return ctx.officeId;
    throw new BadRequestException('Choose the office that keeps the token.');
  }

  private async detail(client: PoolClient, id: string): Promise<DscTokenDetail> {
    const today = istToday();
    const { rows } = await client.query<TokenRow & { can_pin: boolean }>(
      `SELECT x.*, (x.entity_id IS NOT NULL AND hsdg.ctx_can_manage_credentials(x.entity_id)
                    AND NOT hsdg.ctx_is_desk_only()) AS can_pin
         FROM (${TOKEN_SELECT} WHERE t.id = $2) x`,
      [today, id],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException(NOT_FOUND);
    const { rows: moves } = await client.query<{
      id: string;
      kind: DscMovementKind;
      at: Date;
      by_name: string | null;
      with_name: string | null;
      purpose: string | null;
      expected_back_at: Date | null;
    }>(
      `SELECT m.id, m.kind, m.at, b.full_name AS by_name,
              COALESCE(w.full_name, m.with_name) AS with_name, m.purpose, m.expected_back_at
         FROM hsdg.dsc_movements m
         LEFT JOIN hsdg.employees b ON b.id = m.by_employee_id
         LEFT JOIN hsdg.employees w ON w.id = m.with_employee_id
        WHERE m.token_id = $1
        ORDER BY m.at DESC, m.created_at DESC
        LIMIT 50`,
      [id],
    );
    const movements: DscMovement[] = moves.map((m) => ({
      id: m.id,
      kind: m.kind,
      at: m.at.toISOString(),
      byName: m.by_name,
      withName: m.with_name,
      purpose: m.purpose,
      expectedBackAt: m.expected_back_at ? m.expected_back_at.toISOString() : null,
    }));
    return { ...tokenOf(r, today), movements, canPin: r.can_pin };
  }
}

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function upperOrNull(v: string | null | undefined): string | null {
  const t = trimOrNull(v);
  return t ? t.toUpperCase() : null;
}

function checkDates(validFrom: string | null, validTo: string): void {
  if (validFrom && validFrom > validTo)
    throw new BadRequestException('A token is valid from a day on or before its expiry.');
}
