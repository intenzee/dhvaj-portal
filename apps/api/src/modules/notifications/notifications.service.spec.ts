import type { PoolClient } from 'pg';
import type { ClsService } from 'nestjs-cls';
import { NOTIFICATION_TYPE } from '@hsdg/contracts';
import type { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { NotificationsService } from './notifications.service';
import type { NotificationChannel } from './channels/notification-channel';

/**
 * Unit-level checks on the emission fan-out. Recipients are de-duplicated and
 * NULL/undefined dropped, then emitted in ONE batched round-trip (emit_notification
 * called once per element of a `unnest` array — not a JS loop). External delivery
 * is decoupled: created notifications are ENQUEUED to the durable outbox via
 * enqueue_delivery (one call per channel), so a channel can never make emit fail.
 */
describe('NotificationsService.emitWith', () => {
  const ctx: RlsContext = { userId: 'u1', role: 'partner', officeId: 'o1', employeeId: 'e-actor' };
  const inactiveCls = { isActive: () => false } as unknown as ClsService;
  const db = {} as DatabaseService;

  /**
   * A fake client that emulates the two batched queries emitWith issues:
   *  • emit_notification over unnest($1) — returns one row per recipient, the
   *    user id derived from `created(employeeId)`;
   *  • enqueue_delivery over unnest($1) — records the delivered uids it was given.
   */
  function fakeClient(created: (employeeId: string) => string | null): {
    client: PoolClient;
    emitParams: unknown[][];
    enqueueParams: unknown[][];
  } {
    const emitParams: unknown[][] = [];
    const enqueueParams: unknown[][] = [];
    const client = {
      query: (sql: string, params: unknown[]) => {
        if (sql.includes('emit_notification')) {
          emitParams.push(params);
          const recipients = params[0] as string[];
          return Promise.resolve({
            rows: recipients.map((emp) => ({ recipient_user_id: created(emp) })),
          });
        }
        // enqueue_delivery — external outbox enqueue.
        enqueueParams.push(params);
        return Promise.resolve({ rows: [] });
      },
    } as unknown as PoolClient;
    return { client, emitParams, enqueueParams };
  }

  it('de-duplicates recipients, drops null/undefined, and counts only created rows', async () => {
    const channel: NotificationChannel = { name: 'fake', deliver: async () => {} };
    const service = new NotificationsService(db, inactiveCls, [channel]);
    const { client, emitParams, enqueueParams } = fakeClient((emp) =>
      emp === 'e-nouser' ? null : `user-${emp}`,
    );

    const created = await service.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.taskAssigned,
      recipientEmployeeIds: ['e1', 'e1', null, undefined, 'e2', 'e-nouser'],
      title: 'Assigned',
    });

    // One batched emit call, whose recipient array is deduped with nulls dropped.
    expect(emitParams).toHaveLength(1);
    expect(emitParams[0]![0]).toEqual(['e1', 'e2', 'e-nouser']);
    // e-nouser resolves to no user → only two notifications created.
    expect(created).toBe(2);
    // External delivery enqueued once (one channel), for the two created rows only.
    expect(enqueueParams).toHaveLength(1);
    expect([...(enqueueParams[0]![0] as string[])].sort()).toEqual(['user-e1', 'user-e2']);
  });

  it('creates nothing and enqueues nothing when every recipient is null', async () => {
    const channel: NotificationChannel = { name: 'fake', deliver: async () => {} };
    const service = new NotificationsService(db, inactiveCls, [channel]);
    const { client, emitParams, enqueueParams } = fakeClient(() => null);

    const created = await service.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.taskAssigned,
      recipientEmployeeIds: [null, undefined],
      title: 'Nobody',
    });

    expect(created).toBe(0);
    expect(emitParams).toHaveLength(0);
    expect(enqueueParams).toHaveLength(0);
  });

  it('emit succeeds independently of external channels (durable-outbox decoupling)', async () => {
    // Delivery is decoupled to the outbox worker, so even a channel whose
    // deliver() would throw cannot make emit fail — its deliver() is never called
    // from the request path.
    const throwing: NotificationChannel = {
      name: 'boom',
      deliver: async () => {
        throw new Error('channel down');
      },
    };
    const service = new NotificationsService(db, inactiveCls, [throwing]);
    const { client } = fakeClient((emp) => `user-${emp}`);

    await expect(
      service.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.epChanged,
        recipientEmployeeIds: ['e1'],
        title: 'EP changed',
      }),
    ).resolves.toBe(1);
  });
});
