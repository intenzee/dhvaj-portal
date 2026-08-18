import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
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
      useFactory: (config: AppConfigService): Pool =>
        new Pool({
          connectionString: config.get('DATABASE_URL'),
          max: config.get('DATABASE_POOL_MAX'),
          ssl: config.get('DATABASE_SSL') ? { rejectUnauthorized: true } : undefined,
          statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS'),
          application_name: 'hsdg-api',
        }),
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
