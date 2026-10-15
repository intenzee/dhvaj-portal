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
  type CredentialPortal,
  type EntityCredentials,
  type RegistrationCredential,
  type RevealedCredential,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CredentialCipher, credentialAad, type CredentialSecret } from './credential-cipher';

interface CredentialRow {
  id: string;
  registration_id: string;
  portal: CredentialPortal;
  username_hint: string;
  updated_at: Date;
  updated_by: string | null;
}

const NOT_READY =
  'Client logins are not set up on this server yet (CREDENTIALS_KEYS). Ask the administrator.';

const LIST_SQL = `
  SELECT c.id, c.registration_id, c.portal, c.username_hint, c.updated_at,
         (SELECT u.display_name FROM hsdg.users u WHERE u.id = c.updated_by_user_id) AS updated_by
    FROM hsdg.registration_credentials c
    JOIN hsdg.entity_registrations r ON r.id = c.registration_id`;

function toCredential(r: CredentialRow): RegistrationCredential {
  return {
    id: r.id,
    registrationId: r.registration_id,
    portal: r.portal,
    usernameHint: r.username_hint,
    updatedAt: r.updated_at.toISOString(),
    updatedBy: r.updated_by,
  };
}

/**
 * ADR-0035 — clients' saved portal logins. Lists carry only a masked user
 * name; the secret is sealed here before it is written, and read back only
 * through hsdg.reveal_registration_credential, which checks the caller,
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
          WHERE ($1::uuid IS NULL OR r.entity_id = $1) AND ($2::uuid IS NULL OR r.id = $2)
          ORDER BY r.registration_number, c.portal`,
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

  /** PUT /credentials — save (or replace) a registration's login. */
  async save(
    ctx: RlsContext,
    input: { registrationId: string; portal: CredentialPortal } & CredentialSecret,
  ): Promise<RegistrationCredential> {
    return this.db.withRlsContext(ctx, (client) => this.saveWith(client, ctx, input));
  }

  /** Save inside the caller's transaction (the GST import uses it per row). */
  async saveWith(
    client: PoolClient,
    ctx: RlsContext,
    input: { registrationId: string; portal: CredentialPortal } & CredentialSecret,
  ): Promise<RegistrationCredential> {
    if (!this.cipher.ready) throw new ServiceUnavailableException(NOT_READY);
    const username = input.username.trim();
    if (!username || !input.password)
      throw new BadRequestException('Both the user name and the password are needed.');
    const reg = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.entity_registrations WHERE id = $1`,
      [input.registrationId],
    );
    if (reg.rowCount === 0) throw new NotFoundException('Registration not found.');

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.registration_credentials WHERE registration_id = $1 AND portal = $2`,
      [input.registrationId, input.portal],
    );
    const id = existing.rows[0]?.id ?? randomUUID();
    const sealed = this.cipher.seal(
      { username, password: input.password },
      credentialAad(id, input.registrationId, input.portal),
    );
    const values = [
      id,
      input.registrationId,
      input.portal,
      usernameHint(username),
      sealed.ciphertext,
      sealed.iv,
      sealed.authTag,
      sealed.keyVersion,
      ctx.userId,
    ];
    try {
      if (existing.rowCount) {
        const res = await client.query(
          `UPDATE hsdg.registration_credentials
              SET username_hint = $4, ciphertext = $5, iv = $6, auth_tag = $7,
                  key_version = $8, updated_by_user_id = $9
            WHERE id = $1 AND registration_id = $2 AND portal = $3`,
          values,
        );
        if (res.rowCount === 0)
          throw new ForbiddenException(
            'Only a partner or manager of the client’s office can change its login.',
          );
      } else {
        await client.query(
          `INSERT INTO hsdg.registration_credentials
             (id, registration_id, portal, username_hint, ciphertext, iv, auth_tag,
              key_version, created_by_user_id, updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
          values,
        );
      }
    } catch (err) {
      if ((err as { code?: string }).code === '42501')
        throw new ForbiddenException(
          'Only a partner or manager of the client’s office can change its login.',
        );
      throw err;
    }
    await this.audit.recordWith(client, ctx, {
      action: existing.rowCount ? 'credential.updated' : 'credential.saved',
      objectType: 'registration_credential',
      objectId: id,
      after: { registrationId: input.registrationId, portal: input.portal },
    });
    const { rows } = await client.query<CredentialRow>(`${LIST_SQL} WHERE c.id = $1`, [id]);
    return toCredential(rows[0]!);
  }

  /** DELETE /credentials/:id */
  async remove(ctx: RlsContext, id: string): Promise<void> {
    await this.db.withRlsContext(ctx, async (client) => {
      const seen = await client.query<{ registration_id: string; portal: string }>(
        `SELECT registration_id, portal FROM hsdg.registration_credentials WHERE id = $1`,
        [id],
      );
      if (seen.rowCount === 0) throw new NotFoundException('Login not found.');
      const res = await client.query(`DELETE FROM hsdg.registration_credentials WHERE id = $1`, [
        id,
      ]);
      if (res.rowCount === 0)
        throw new ForbiddenException(
          'Only a partner or manager of the client’s office can remove its login.',
        );
      await this.audit.recordWith(client, ctx, {
        action: 'credential.removed',
        objectType: 'registration_credential',
        objectId: id,
        before: { registrationId: seen.rows[0]!.registration_id, portal: seen.rows[0]!.portal },
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
        registration_id: string;
        portal: CredentialPortal;
      };
      try {
        const { rows } = await client.query(
          `SELECT * FROM hsdg.reveal_registration_credential($1)`,
          [id],
        );
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
        credentialAad(id, row.registration_id, row.portal),
      );
      await this.audit.recordWith(client, ctx, {
        action: 'credential.revealed',
        objectType: 'registration_credential',
        objectId: id,
        after: { registrationId: row.registration_id, portal: row.portal },
      });
      return { id, portal: row.portal, ...secret };
    });
  }
}
