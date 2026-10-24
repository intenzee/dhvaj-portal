import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  usernameHint,
  type ClientCredential,
  type CredentialAccount,
  type CredentialPortal,
  type EntityCredentials,
  type GstFrequency,
  type RevealedCredential,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CredentialCipher, credentialAad, type CredentialSecret } from './credential-cipher';

interface CredentialRow {
  id: string;
  entity_id: string;
  registration_id: string | null;
  registration_number: string | null;
  state_code: string | null;
  portal: CredentialPortal;
  account: CredentialAccount;
  username_hint: string;
  pending_gst_scheme: 'regular' | 'qrmp' | null;
  updated_at: Date;
  updated_by: string | null;
}

/** What a login is saved against. */
export interface SaveCredentialInput extends CredentialSecret {
  entityId: string;
  registrationId: string | null;
  portal: CredentialPortal;
  account: CredentialAccount;
  /** A GST login without its GSTIN: the state it is for. */
  stateCode: string | null;
  /** A GST login without its GSTIN: the frequency to apply when the GSTIN comes. */
  pendingFrequency?: GstFrequency | null;
}

const NOT_READY =
  'Client logins are not set up on this server yet (CREDENTIALS_KEYS). Ask the administrator.';
const MANAGE_ONLY = 'Only a partner or manager of the client’s office can change its logins.';

/** The accounts each portal has. */
const ACCOUNTS: Partial<Record<CredentialPortal, CredentialAccount[]>> = {
  income_tax: ['main', 'tan'],
  traces: ['deductor', 'taxpayer'],
};

const LIST_SQL = `
  SELECT c.id, c.entity_id, c.registration_id, r.registration_number, c.state_code, c.portal,
         c.account, c.username_hint, c.pending_gst_scheme, c.updated_at,
         (SELECT u.display_name FROM hsdg.users u WHERE u.id = c.updated_by_user_id) AS updated_by
    FROM hsdg.client_credentials c
    LEFT JOIN hsdg.entity_registrations r ON r.id = c.registration_id`;

const ORDER = `
  ORDER BY array_position(ARRAY['gst','income_tax','traces','mca','eway_bill','einvoice'], c.portal),
           c.account, r.registration_number NULLS LAST, c.state_code NULLS LAST`;

function toCredential(r: CredentialRow): ClientCredential {
  return {
    id: r.id,
    entityId: r.entity_id,
    registrationId: r.registration_id,
    registrationNumber: r.registration_number,
    stateCode: r.state_code,
    portal: r.portal,
    account: r.account,
    usernameHint: r.username_hint,
    pendingFrequency:
      r.pending_gst_scheme === 'qrmp'
        ? 'quarterly'
        : r.pending_gst_scheme === 'regular'
          ? 'monthly'
          : null,
    updatedAt: r.updated_at.toISOString(),
    updatedBy: r.updated_by,
  };
}

/**
 * ADR-0035 — clients' saved portal logins. Lists carry only a masked user
 * name; the secret is sealed here before it is written, and read back only
 * through hsdg.reveal_client_credential, which checks the caller,
 * rate-limits and logs every reveal in the database. Nothing secret is ever
 * written to the audit log.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
  ) {}

  get vaultReady(): boolean {
    return this.cipher.ready;
  }

  /** GET /credentials?entityId= | registrationId= */
  async list(
    ctx: RlsContext,
    by: { entityId?: string; registrationId?: string },
  ): Promise<EntityCredentials> {
    if (!by.entityId && !by.registrationId)
      throw new BadRequestException('Give an entityId or a registrationId.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<CredentialRow>(
        `${LIST_SQL}
          WHERE ($1::uuid IS NULL OR c.entity_id = $1) AND ($2::uuid IS NULL OR c.registration_id = $2)
          ${ORDER}`,
        [by.entityId ?? null, by.registrationId ?? null],
      );
      const items = rows.map(toCredential);
      // The reveal log is readable only by partners (RLS); others get [].
      const { rows: access } = await client.query<{
        credential_id: string;
        user_name: string | null;
        role: string;
        revealed_at: Date;
      }>(
        `SELECT l.credential_id, l.role, l.revealed_at,
                (SELECT u.display_name FROM hsdg.users u WHERE u.id = l.user_id) AS user_name
           FROM hsdg.credential_access_log l
          WHERE l.credential_id = ANY($1::uuid[])
          ORDER BY l.revealed_at DESC LIMIT 20`,
        [items.map((i) => i.id)],
      );
      return {
        vaultReady: this.cipher.ready,
        items,
        recentAccess: access.map((a) => ({
          credentialId: a.credential_id,
          userName: a.user_name,
          role: a.role,
          revealedAt: a.revealed_at.toISOString(),
        })),
      };
    });
  }

  /** PUT /credentials — save (or replace) one of a client's logins. */
  async save(ctx: RlsContext, input: SaveCredentialInput): Promise<ClientCredential> {
    return this.db.withRlsContext(ctx, (client) => this.saveWith(client, ctx, input));
  }

  /**
   * Save inside the caller's transaction (the import uses it per client). A
   * GST login names its GSTIN, or its state until the GSTIN is added — when
   * the client already has that state's GSTIN it goes onto it at once.
   */
  async saveWith(
    client: PoolClient,
    ctx: RlsContext,
    input: SaveCredentialInput,
  ): Promise<ClientCredential> {
    if (!this.cipher.ready) throw new ServiceUnavailableException(NOT_READY);
    const username = input.username.trim();
    if (!username || !input.password)
      throw new BadRequestException('Both the user name and the password are needed.');
    const { portal, account } = input;
    if (!(ACCOUNTS[portal] ?? ['main']).includes(account))
      throw new BadRequestException(`A ${portal} login cannot be a "${account}" login.`);

    const entity = await client.query(`SELECT 1 FROM hsdg.entities WHERE id = $1`, [
      input.entityId,
    ]);
    if (entity.rowCount === 0) throw new NotFoundException('Client not found.');

    let registrationId = input.registrationId;
    let stateCode = portal === 'gst' ? input.stateCode : null;
    if (registrationId) {
      const reg = await client.query<{ registration_type: string; registration_number: string }>(
        `SELECT registration_type, registration_number FROM hsdg.entity_registrations
          WHERE id = $1 AND entity_id = $2`,
        [registrationId, input.entityId],
      );
      const r = reg.rows[0];
      if (!r) throw new NotFoundException('Registration not found on this client.');
      const wants = portal === 'gst' ? 'gstin' : 'tan';
      if (
        r.registration_type !== wants ||
        (portal !== 'gst' && !['tan', 'deductor'].includes(account))
      )
        throw new BadRequestException(
          `This login cannot be tied to a ${r.registration_type.toUpperCase()}.`,
        );
      if (portal === 'gst') stateCode = r.registration_number.slice(0, 2);
    } else if (portal === 'gst' && stateCode) {
      // The client already has a GSTIN in that state: the login is for it.
      const regs = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.entity_registrations
          WHERE entity_id = $1 AND registration_type = 'gstin' AND left(registration_number, 2) = $2`,
        [input.entityId, stateCode],
      );
      if (regs.rowCount === 1) registrationId = regs.rows[0]!.id;
    }
    if (stateCode && !/^\d{2}$/.test(stateCode))
      throw new BadRequestException('A GST state code is two digits, e.g. 07 for Delhi.');
    const pendingScheme =
      portal === 'gst' && !registrationId && input.pendingFrequency
        ? input.pendingFrequency === 'quarterly'
          ? 'qrmp'
          : 'regular'
        : null;

    const existing = await client.query<{ id: string; pending_gst_scheme: string | null }>(
      `SELECT id, pending_gst_scheme FROM hsdg.client_credentials
        WHERE entity_id = $1 AND portal = $2 AND account = $3
          AND COALESCE(registration_id::text, state_code, '') = COALESCE($4::text, $5::text, '')`,
      [input.entityId, portal, account, registrationId, stateCode],
    );
    const before = existing.rows[0];
    const id = before?.id ?? randomUUID();
    const sealed = this.cipher.seal(
      { username, password: input.password },
      credentialAad(id, input.entityId, portal, account),
    );
    const values = [
      id,
      input.entityId,
      registrationId,
      portal,
      account,
      stateCode,
      // Saving without a frequency keeps the one waiting.
      pendingScheme ?? (registrationId ? null : (before?.pending_gst_scheme ?? null)),
      usernameHint(username),
      sealed.ciphertext,
      sealed.iv,
      sealed.authTag,
      sealed.keyVersion,
      ctx.userId,
    ];
    try {
      if (before) {
        const res = await client.query(
          `UPDATE hsdg.client_credentials
              SET registration_id = $3, state_code = $6, pending_gst_scheme = $7,
                  username_hint = $8, ciphertext = $9, iv = $10, auth_tag = $11,
                  key_version = $12, updated_by_user_id = $13
            WHERE id = $1 AND entity_id = $2 AND portal = $4 AND account = $5`,
          values,
        );
        if (res.rowCount === 0) throw new ForbiddenException(MANAGE_ONLY);
      } else {
        await client.query(
          `INSERT INTO hsdg.client_credentials
             (id, entity_id, registration_id, portal, account, state_code, pending_gst_scheme,
              username_hint, ciphertext, iv, auth_tag, key_version,
              created_by_user_id, updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
          values,
        );
      }
    } catch (err) {
      if ((err as { code?: string }).code === '42501') throw new ForbiddenException(MANAGE_ONLY);
      throw err;
    }
    await this.audit.recordWith(client, ctx, {
      action: before ? 'credential.updated' : 'credential.saved',
      objectType: 'client_credential',
      objectId: id,
      after: { entityId: input.entityId, registrationId, portal, account, stateCode },
    });
    const { rows } = await client.query<CredentialRow>(`${LIST_SQL} WHERE c.id = $1`, [id]);
    return toCredential(rows[0]!);
  }

  /** DELETE /credentials/:id */
  async remove(ctx: RlsContext, id: string): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      const seen = await client.query<{
        entity_id: string;
        registration_id: string | null;
        portal: string;
        account: string;
      }>(
        `SELECT entity_id, registration_id, portal, account FROM hsdg.client_credentials WHERE id = $1`,
        [id],
      );
      const was = seen.rows[0];
      if (!was) throw new NotFoundException('Login not found.');
      const res = await client.query(`DELETE FROM hsdg.client_credentials WHERE id = $1`, [id]);
      if (res.rowCount === 0) throw new ForbiddenException(MANAGE_ONLY);
      await this.audit.recordWith(client, ctx, {
        action: 'credential.removed',
        objectType: 'client_credential',
        objectId: id,
        before: {
          entityId: was.entity_id,
          registrationId: was.registration_id,
          portal: was.portal,
          account: was.account,
        },
      });
    });
  }

  /** POST /credentials/:id/reveal — the secret, once; the database logs the read. */
  async reveal(ctx: RlsContext, id: string): Promise<RevealedCredential> {
    if (!this.cipher.ready) throw new ServiceUnavailableException(NOT_READY);
    return this.db.withRlsContext(ctx, async (client) => {
      let row: {
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
        key_version: number;
        entity_id: string;
        portal: CredentialPortal;
        account: CredentialAccount;
      };
      try {
        const { rows } = await client.query(`SELECT * FROM hsdg.reveal_client_credential($1)`, [
          id,
        ]);
        row = rows[0];
      } catch (err) {
        const message = (err as { message?: string }).message ?? '';
        if (message.includes('credential_not_found'))
          throw new NotFoundException('Login not found.');
        if (message.includes('credential_forbidden'))
          throw new ForbiddenException(
            'Only the client’s partner or the team on its engagements can see this login.',
          );
        if (message.includes('credential_rate_limited'))
          throw new HttpException(
            'Too many logins shown in the last hour. Try again later.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        throw err;
      }
      const secret = this.cipher.open(
        {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyVersion: row.key_version,
        },
        credentialAad(id, row.entity_id, row.portal, row.account),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'credential.revealed',
        objectType: 'client_credential',
        objectId: id,
        after: { entityId: row.entity_id, portal: row.portal, account: row.account },
      });
      return { id, portal: row.portal, account: row.account, ...secret };
    });
  }

  /**
   * Every login the caller may reveal (as a single reveal decides), opened,
   * by its id — for the Client Master export with passwords. The database
   * logs each one; the caller's transaction must commit for the log to stay.
   */
  async openForExportWith(client: PoolClient): Promise<Map<string, CredentialSecret>> {
    if (!this.cipher.ready) throw new ServiceUnavailableException(NOT_READY);
    let rows: {
      id: string;
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      key_version: number;
      entity_id: string;
      portal: CredentialPortal;
      account: CredentialAccount;
    }[];
    try {
      ({ rows } = await client.query(`SELECT * FROM hsdg.export_client_credentials()`));
    } catch (err) {
      if (((err as { message?: string }).message ?? '').includes('credential_rate_limited'))
        throw new HttpException(
          'Exported with passwords 5 times in the last hour. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw err;
    }
    return new Map(
      rows.map((r) => [
        r.id,
        this.cipher.open(
          {
            ciphertext: r.ciphertext,
            iv: r.iv,
            authTag: r.auth_tag,
            keyVersion: r.key_version,
          },
          credentialAad(r.id, r.entity_id, r.portal, r.account),
        ),
      ]),
    );
  }
}
