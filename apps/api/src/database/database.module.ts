import { Global, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import './pg-types'; // Register pg type-parser overrides (dates) before any query runs.
import { AppConfigService } from '../config/config.module';
import { PG_POOL } from './database.constants';
import { DatabaseService } from './database.service';

/**
 * Owns the single pg connection pool and the {@link DatabaseService} gateway.
 * Global so any domain module (added in later phases) can inject the gateway
 * without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Pool => {
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL'),
          max: config.get('DATABASE_POOL_MAX'),
          ssl: config.get('DATABASE_SSL') ? { rejectUnauthorized: true } : undefined,
          statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS'),
          application_name: 'hsdg-api',
          // Idle connections go quickly, so none is left for a sleeping
          // database to cut.
          idleTimeoutMillis: 10_000,
        });
        // A serverless database (Neon) closes every session when it scales to
        // zero. An idle pooled connection cut that way surfaces here; unhandled
        // it would end the process. The pool drops it and opens a new one on
        // the next query, which wakes the database.
        pool.on('error', (err) => {
          new Logger('DatabasePool').warn(`Idle database connection closed: ${err.message}`);
        });
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
