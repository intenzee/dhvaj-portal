import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../database/database.service';

/**
 * Readiness signal for PostgreSQL. The service is only "ready" to take traffic
 * if it can reach its system of record.
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async pingCheck(key = 'database'): Promise<HealthIndicatorResult> {
    try {
      await this.db.ping();
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Database ping failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
    }
  }
}
