import { Injectable, Logger } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../database/database.service';

/**
 * Readiness signal for PostgreSQL. The service is only "ready" to take traffic
 * if it can reach its system of record.
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(private readonly db: DatabaseService) {
    super();
  }

  async pingCheck(key = 'database'): Promise<HealthIndicatorResult> {
    try {
      await this.db.ping();
      return this.getStatus(key, true);
    } catch (error) {
      // The probe is public: the reason (host names, role names) goes to the
      // log, never into the response.
      this.logger.error(
        `Database ping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HealthCheckError(
        'Database ping failed',
        this.getStatus(key, false, { message: 'unreachable' }),
      );
    }
  }
}
