import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { CHANGE_SET_SETTINGS, PG_POOL, RLS_SETTINGS } from './database.constants';
import { CLS_CHANGE_LABEL, CLS_CHANGE_SET } from '../common/context/change-set.interceptor';
import type { RlsContext } from './rls-context';

/**
 * The one gateway to PostgreSQL for the whole application.
 *
 * Security model (see ADR-0001):
 *  - The pool connects as the least-privilege `hsdg_app` role — never the owner
 *    or a superuser, and never a role with BYPASSRLS.
 *  - All access that must respect RLS goes through {@link withRlsContext}, which
 *    opens a transaction, stamps the security context with `SET LOCAL`, and runs
 *    the caller's work against that client. The context cannot outlive the
 *    transaction, so it can never bleed across pooled connections.
 *  - On boot we assert the connection is genuinely least-privilege; if it is a
 *    superuser or can bypass RLS we refuse to start (fail-closed).
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() private readonly cls?: ClsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.assertLeastPrivilege();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Run a query outside any RLS context. Reserved for infrastructure concerns
   * (health checks, migrations metadata). Business/domain reads and writes must
   * use {@link withRlsContext} so policies apply.
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as unknown[]);
  }

  /** Liveness/readiness probe: cheap round-trip to the database. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /**
   * Execute `work` inside a single transaction whose local settings carry the
   * given security context. Commits on success, rolls back on any error.
   */
  async withRlsContext<T>(
    context: RlsContext,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.applyContext(client, context);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Transaction helper with no security context. Use only for operations that
   * are not subject to RLS.
   */
  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Run `work` only if no other API instance is running the job `name` right
   * now (a session advisory lock on a dedicated connection). With several
   * instances each firing the same cron, exactly one does the work; the others
   * skip. Resolves to `{ ran: false }` when the lock was held elsewhere.
   */
  async runExclusive<T>(
    name: string,
    work: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('hsdg-job:' || $1)) AS locked`,
        [name],
      );
      locked = rows[0]?.locked === true;
      if (!locked) return { ran: false };
      return { ran: true, result: await work() };
    } finally {
      if (locked) {
        await client
          .query(`SELECT pg_advisory_unlock(hashtext('hsdg-job:' || $1))`, [name])
          .catch(() => undefined);
      }
      client.release();
    }
  }

  private async applyContext(client: PoolClient, context: RlsContext): Promise<void> {
    // All settings in ONE round-trip. Parameterised set_config() calls (not
    // string interpolation) so context values can never be used for SQL
    // injection. `true` => transaction-local (cleared at COMMIT/ROLLBACK).
    await client.query(
      `SELECT set_config($1, $2, true),
              set_config($3, $4, true),
              set_config($5, $6, true),
              set_config($7, $8, true),
              set_config($9, $10, true),
              set_config($11, $12, true),
              set_config($13, $14, true)`,
      [
        RLS_SETTINGS.userId,
        context.userId,
        RLS_SETTINGS.role,
        context.role,
        RLS_SETTINGS.officeId,
        context.officeId ?? '',
        RLS_SETTINGS.orgId,
        context.orgId ?? '',
        RLS_SETTINGS.employeeId,
        context.employeeId ?? '',
        // The request's change set, so the audit-file undo log can group
        // everything one click changed (empty outside a mutating request).
        CHANGE_SET_SETTINGS.id,
        this.ambient(CLS_CHANGE_SET),
        CHANGE_SET_SETTINGS.label,
        this.ambient(CLS_CHANGE_LABEL),
      ],
    );
  }

  private ambient(key: string): string {
    return (this.cls?.isActive() ? this.cls.get<string | undefined>(key) : undefined) ?? '';
  }

  /**
   * Fail-closed startup guard. The application must not run with a database
   * connection that can silently bypass Row Level Security.
   */
  private async assertLeastPrivilege(): Promise<void> {
    const { rows } = await this.pool.query<{
      current_user: string;
      is_superuser: boolean;
      is_bypassrls: boolean;
      owns_schema: boolean;
    }>(
      `SELECT
         current_user,
         rolsuper   AS is_superuser,
         rolbypassrls AS is_bypassrls,
         EXISTS (
           SELECT 1 FROM pg_namespace n
           WHERE n.nspname = 'hsdg' AND pg_has_role(current_user, n.nspowner, 'MEMBER')
         ) AS owns_schema
       FROM pg_roles
       WHERE rolname = current_user`,
    );

    const role = rows[0];
    if (!role) {
      throw new InternalServerErrorException('Unable to determine the database role identity.');
    }

    if (role.is_superuser || role.is_bypassrls) {
      throw new InternalServerErrorException(
        `Refusing to start: application connected as "${role.current_user}" ` +
          `which is superuser=${role.is_superuser} bypassrls=${role.is_bypassrls}. ` +
          `The API must use a least-privilege role that RLS applies to.`,
      );
    }

    // The schema owner (the migrator) can ALTER/DISABLE the policies and, on any
    // table not FORCE'd, is exempt from them — never the runtime role.
    if (role.owns_schema) {
      throw new InternalServerErrorException(
        `Refusing to start: application connected as "${role.current_user}", which owns ` +
          `(or is a member of the owner of) the hsdg schema. Use the hsdg_app role.`,
      );
    }

    this.logger.log(`Database connection verified as least-privilege role "${role.current_user}".`);
  }
}
