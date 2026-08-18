import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { PG_POOL, RLS_SETTINGS } from './database.constants';
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

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

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

  private async applyContext(client: PoolClient, context: RlsContext): Promise<void> {
    // Parameterised set_config() calls (not string interpolation) so context
    // values can never be used for SQL injection. `true` => transaction-local.
    await client.query(`SELECT set_config($1, $2, true)`, [RLS_SETTINGS.userId, context.userId]);
    await client.query(`SELECT set_config($1, $2, true)`, [RLS_SETTINGS.role, context.role]);
    await client.query(`SELECT set_config($1, $2, true)`, [
      RLS_SETTINGS.officeId,
      context.officeId ?? '',
    ]);
    await client.query(`SELECT set_config($1, $2, true)`, [
      RLS_SETTINGS.orgId,
      context.orgId ?? '',
    ]);
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
    }>(
      `SELECT
         current_user,
         rolsuper   AS is_superuser,
         rolbypassrls AS is_bypassrls
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

    this.logger.log(`Database connection verified as least-privilege role "${role.current_user}".`);
  }
}
