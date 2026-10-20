import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLE_PRECEDENCE, SYSTEM_ROLE } from '@hsdg/contracts';
import { AppConfigService } from '../../config/config.module';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import type { PrincipalData } from '../identity/identity.types';
import { PasswordAuthProvider } from './password-auth.provider';
import { rlsContextFromPrincipal, type Principal } from './principal';
import {
  decoyPasswordHash,
  generateTemporaryPassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './passwords';

/** Wrong passwords in a row before the password is locked, and for how long. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const WRONG = 'Email or password is incorrect.';
const LOCKED = `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes, or ask an administrator to reset it.`;

export interface PasswordSession {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export type PasswordLoginResult = PasswordSession | { mustChangePassword: true };

export interface PasswordStatus {
  mustChange: boolean;
  locked: boolean;
}

interface PasswordRow {
  password_hash: string;
  must_change: boolean;
  version: number;
  locked_until: Date | null;
}

/**
 * Email + password sign-in. Passwords are set by an admin (a temporary one the
 * person must replace at first sign-in) and changed by the person. Every read
 * or write of a hash runs in the reserved 'system' context — the only one the
 * table's row-level security admits.
 */
@Injectable()
export class PasswordLoginService {
  constructor(
    private readonly config: AppConfigService,
    private readonly db: DatabaseService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly sessions: PasswordAuthProvider,
  ) {}

  get enabled(): boolean {
    return this.config.get('AUTH_PASSWORD_LOGIN');
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }

  private get system(): RlsContext {
    return { userId: '', role: SYSTEM_ROLE, officeId: '' };
  }

  private actorOf(user: PrincipalData): RlsContext {
    const role = ROLE_PRECEDENCE.find((r) => user.roles.includes(r)) ?? '';
    return { userId: user.userId, role, officeId: user.officeId };
  }

  async login(email: string, password: string): Promise<PasswordLoginResult> {
    this.assertEnabled();
    const { user, row } = await this.checkPassword(email, password);
    if (row.must_change) return { mustChangePassword: true };
    await this.audit.record(this.actorOf(user), {
      action: 'auth.password_login',
      objectType: 'user',
      objectId: user.userId,
    });
    return this.session(user, row.version);
  }

  /** The person replaces their password (the temporary one, or their own). */
  async changePassword(email: string, current: string, next: string): Promise<PasswordSession> {
    this.assertEnabled();
    const { user } = await this.checkPassword(email, current);
    const problem = passwordProblem(next, user.email);
    if (problem) throw new BadRequestException(problem);
    if (next === current)
      throw new BadRequestException('Choose a password different from the current one.');

    const hash = await hashPassword(next);
    const version = await this.db.withRlsContext(this.system, async (client) => {
      const { rows } = await client.query<{ version: number }>(
        `UPDATE hsdg.user_passwords
            SET password_hash = $2, must_change = false, version = version + 1,
                failed_attempts = 0, locked_until = NULL, set_by_user_id = $1, changed_at = now()
          WHERE user_id = $1
          RETURNING version`,
        [user.userId, hash],
      );
      return rows[0]!.version;
    });
    await this.audit.record(this.actorOf(user), {
      action: 'auth.password_changed',
      objectType: 'user',
      objectId: user.userId,
    });
    return this.session(user, version);
  }

  /** A fresh session for a signed-in password user (the portal renews while in use). */
  async renew(principal: Principal, passwordVersion: number): Promise<PasswordSession> {
    this.assertEnabled();
    const { token, expiresIn } = await this.sessions.issue(
      principal.userId,
      principal.email,
      passwordVersion,
    );
    return { accessToken: token, tokenType: 'Bearer', expiresIn };
  }

  /**
   * An admin gives a user a new temporary password (first one, or a reset).
   * Returned once — it is never stored or shown again. Ends the user's
   * password sessions and lifts any lock.
   */
  async setTemporary(actor: Principal, userId: string): Promise<{ temporaryPassword: string }> {
    this.assertEnabled();
    const ctx = rlsContextFromPrincipal(actor);
    const target = await this.identity.getUserById(ctx, userId);
    if (!target) throw new NotFoundException('User not found.');

    const temporaryPassword = generateTemporaryPassword();
    const hash = await hashPassword(temporaryPassword);
    const created = await this.db.withRlsContext(this.system, async (client) => {
      const { rows } = await client.query<{ version: number }>(
        `INSERT INTO hsdg.user_passwords (user_id, password_hash, must_change, set_by_user_id)
         VALUES ($1, $2, true, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, must_change = true,
               version = hsdg.user_passwords.version + 1, failed_attempts = 0,
               locked_until = NULL, set_by_user_id = EXCLUDED.set_by_user_id, changed_at = now()
         RETURNING version`,
        [userId, hash, actor.userId],
      );
      return rows[0]!.version === 1;
    });
    await this.audit.record(ctx, {
      action: created ? 'user.password_set' : 'user.password_reset',
      objectType: 'user',
      objectId: userId,
    });
    return { temporaryPassword };
  }

  /** An admin turns password sign-in off for a user (Microsoft only from now on). */
  async remove(actor: Principal, userId: string): Promise<void> {
    this.assertEnabled();
    const ctx = rlsContextFromPrincipal(actor);
    const target = await this.identity.getUserById(ctx, userId);
    if (!target) throw new NotFoundException('User not found.');
    const removed = await this.db.withRlsContext(this.system, async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM hsdg.user_passwords WHERE user_id = $1',
        [userId],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!removed) throw new NotFoundException('This user has no portal password.');
    await this.audit.record(ctx, {
      action: 'user.password_removed',
      objectType: 'user',
      objectId: userId,
    });
  }

  /** Who has a portal password, for the admin's user list (no hashes leave here). */
  async statuses(): Promise<Record<string, PasswordStatus>> {
    this.assertEnabled();
    return this.db.withRlsContext(this.system, async (client) => {
      const { rows } = await client.query<{
        user_id: string;
        must_change: boolean;
        locked: boolean;
      }>(
        `SELECT user_id, must_change, COALESCE(locked_until > now(), false) AS locked
           FROM hsdg.user_passwords`,
      );
      return Object.fromEntries(
        rows.map((r) => [r.user_id, { mustChange: r.must_change, locked: r.locked }]),
      );
    });
  }

  /** The current password version, or null when the user has no password. */
  async currentVersion(userId: string): Promise<number | null> {
    return this.db.withRlsContext(this.system, async (client) => {
      const { rows } = await client.query<{ version: number }>(
        'SELECT version FROM hsdg.user_passwords WHERE user_id = $1',
        [userId],
      );
      return rows[0]?.version ?? null;
    });
  }

  /**
   * Check an email + password, counting wrong tries. Unknown emails, users
   * without a password and wrong passwords all fail the same way, in about the
   * same time. Inactive and MFA-required users are told only after the
   * password is right.
   */
  private async checkPassword(
    email: string,
    password: string,
  ): Promise<{ user: PrincipalData; row: PasswordRow }> {
    const user = await this.identity.loadPrincipalByEmail(email.trim());
    const row = user ? await this.readRow(user.userId) : null;
    if (!user || !row) {
      await verifyPassword(password, await decoyPasswordHash());
      throw new UnauthorizedException(WRONG);
    }
    if (row.locked_until && row.locked_until.getTime() > Date.now()) {
      throw new UnauthorizedException(LOCKED);
    }

    if (!(await verifyPassword(password, row.password_hash))) {
      const locked = await this.recordFailure(user.userId);
      if (locked) {
        await this.audit.record(this.actorOf(user), {
          action: 'auth.password_locked',
          objectType: 'user',
          objectId: user.userId,
        });
        throw new UnauthorizedException(LOCKED);
      }
      throw new UnauthorizedException(WRONG);
    }
    await this.db.withRlsContext(this.system, (client) =>
      client.query(
        'UPDATE hsdg.user_passwords SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1',
        [user.userId],
      ),
    );

    if (!user.isActive) throw new UnauthorizedException('This account is inactive.');
    if (user.mfaRequired) {
      throw new UnauthorizedException('This account must sign in with Microsoft.');
    }
    return { user, row };
  }

  private async readRow(userId: string): Promise<PasswordRow | null> {
    return this.db.withRlsContext(this.system, async (client) => {
      const { rows } = await client.query<PasswordRow>(
        `SELECT password_hash, must_change, version, locked_until
           FROM hsdg.user_passwords WHERE user_id = $1`,
        [userId],
      );
      return rows[0] ?? null;
    });
  }

  /** Count a wrong try; on the last allowed one, lock. True when now locked. */
  private async recordFailure(userId: string): Promise<boolean> {
    return this.db.withRlsContext(this.system, async (client) => {
      const { rows } = await client.query<{ locked: boolean }>(
        `UPDATE hsdg.user_passwords
            SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
                locked_until = CASE WHEN failed_attempts + 1 >= $2
                                    THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE user_id = $1
          RETURNING locked_until IS NOT NULL AND locked_until > now() AS locked`,
        [userId, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      );
      return rows[0]?.locked ?? false;
    });
  }

  private async session(user: PrincipalData, version: number): Promise<PasswordSession> {
    const { token, expiresIn } = await this.sessions.issue(user.userId, user.email, version);
    return { accessToken: token, tokenType: 'Bearer', expiresIn };
  }
}
