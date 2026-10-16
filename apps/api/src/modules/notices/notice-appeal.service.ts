import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { RlsContext } from '../../database/rls-context';
import type { NoticeRow } from './notices.types';

/**
 * PS-103 seam — what an order does beyond the notice itself. Called on the
 * notice's transaction when an order event is recorded and when one is voided.
 * PS-101 records the order and moves the status; the appeal clock comes later.
 */
@Injectable()
export class NoticeAppealService {
  async onOrderRecorded(
    _client: PoolClient,
    _ctx: RlsContext,
    _notice: NoticeRow,
    _event: { id: string; occurredOn: string },
  ): Promise<void> {
    // PS-103: start the appeal limitation clock.
  }

  async onOrderVoided(
    _client: PoolClient,
    _ctx: RlsContext,
    _notice: NoticeRow,
    _event: { id: string; complianceEventId: string | null },
    _reason: string,
  ): Promise<void> {
    // PS-103: void the limitation clock the order started.
  }
}
