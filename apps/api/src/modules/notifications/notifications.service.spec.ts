import type { PoolClient } from 'pg';
import type { ClsService } from 'nestjs-cls';
import { NOTIFICATION_TYPE } from '@hsdg/contracts';
import type { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { NotificationsService } from './notifications.service';
import type { NotificationChannel } from './channels/notification-channel';
import type { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';

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
  const flags = (firmWide: boolean): FeatureFlagsService =>
    ({ isOnFor: () => firmWide }) as unknown as FeatureFlagsService;

  /**
   * A fake client that emulates the two batched queries emitWith issues:
   *  • emit_notification over unnest($1) — returns one row per recipient, the
   *    user id derived from `created(employeeId)`;
   *  • enqueue_delivery over unnest($1) — records the delivered uids it was given.
   */
  function fakeClient(
    created: (employeeId: string) => string | null,
    linkRows: Record<string, unknown>[] = [],
  ): {
    client: PoolClient;
    emitParams: unknown[][];
    enqueueParams: unknown[][];
    linkParams: unknown[][];
  } {
    const linkParams: unknown[][] = [];
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
        // WF-305 link resolution — the object's engagement and filing.
        if (sql.includes('AS src(engagement_id')) {
          linkParams.push(params);
          return Promise.resolve({ rows: linkRows });
        }
        // enqueue_delivery — external outbox enqueue.
        enqueueParams.push(params);
        return Promise.resolve({ rows: [] });
      },
    } as unknown as PoolClient;
    return { client, emitParams, enqueueParams, linkParams };
  }

  it('de-duplicates recipients, drops null/undefined, and counts only created rows', async () => {
    const channel: NotificationChannel = { name: 'fake', deliver: async () => {} };
    const service = new NotificationsService(db, inactiveCls, [channel], flags(false));
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
    const service = new NotificationsService(db, inactiveCls, [channel], flags(false));
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
    const service = new NotificationsService(db, inactiveCls, [throwing], flags(false));
    const { client } = fakeClient((emp) => `user-${emp}`);

    await expect(
      service.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.epChanged,
        recipientEmployeeIds: ['e1'],
        title: 'EP changed',
      }),
    ).resolves.toBe(1);
  });

  it('stores the link of the object it is about: the filing section and the task (WF-305)', async () => {
    const service = new NotificationsService(db, inactiveCls, [], flags(false));
    const { client, emitParams, linkParams } = fakeClient(
      (emp) => `user-${emp}`,
      [
        {
          engagement_id: 'eng1',
          engagement_kind: 'compliance',
          task_id: 't1',
          request_id: null,
          wl_instance_id: 'ci1',
          wl_stream: 'gst',
          wl_financial_year: '2026-27',
          wl_period_key: '2026-09',
          wl_section: 'outward',
          wl_reference_month: '2026-09',
          wl_registration_number: '19AAACB1234C1Z5',
          wl_form_label: 'GSTR-1',
          wl_internal_date: null,
          wl_statutory_date: null,
        },
      ],
    );
    await service.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.taskReviewRequested,
      recipientEmployeeIds: ['e1'],
      title: 'Review requested',
      engagementId: 'eng1',
      objectType: 'task',
      objectId: 't1',
    });
    expect(linkParams[0]).toEqual(['t1']);
    expect(JSON.parse(emitParams[0]![9] as string)).toEqual({
      engagementId: 'eng1',
      engagementKind: 'compliance',
      instanceId: 'ci1',
      stream: 'gst',
      financialYear: '2026-27',
      periodKey: '2026-09',
      section: 'outward',
      registrationNumber: '19AAACB1234C1Z5',
      taskId: 't1',
    });
  });

  it('falls back to the engagement, and to no link without one', async () => {
    const service = new NotificationsService(db, inactiveCls, [], flags(false));
    const unseen = fakeClient((emp) => `user-${emp}`);
    await service.emitWith(unseen.client, ctx, {
      type: NOTIFICATION_TYPE.epChanged,
      recipientEmployeeIds: ['e1'],
      title: 'EP changed',
      engagementId: 'eng1',
      objectType: 'engagement',
      objectId: 'eng1',
    });
    // No source for 'engagement' objects: one engagement query, which found nothing here.
    expect(unseen.linkParams).toEqual([['eng1']]);
    expect(unseen.emitParams[0]![9]).toBeNull();
  });

  it('holds informational notices for the digest instead of e-mailing them, once firm-wide', async () => {
    const channel: NotificationChannel = { name: 'email', deliver: async () => {} };
    const run = async (
      firmWide: boolean,
      type: (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE],
    ) => {
      const service = new NotificationsService(db, inactiveCls, [channel], flags(firmWide));
      const fake = fakeClient((emp) => `user-${emp}`);
      await service.emitWith(fake.client, ctx, { type, recipientEmployeeIds: ['e1'], title: 'x' });
      return fake.enqueueParams.length;
    };
    expect(await run(true, NOTIFICATION_TYPE.filingLodged)).toBe(0);
    expect(await run(false, NOTIFICATION_TYPE.filingLodged)).toBe(1);
    expect(await run(true, NOTIFICATION_TYPE.taskReviewRequested)).toBe(1);
  });
});
