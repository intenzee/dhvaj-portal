import type { PoolClient } from 'pg';
import type { ClsService } from 'nestjs-cls';
import { NOTIFICATION_TYPE } from '@hsdg/contracts';
import type { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { NotificationsService } from './notifications.service';
import type { NotificationChannel, OutboundNotification } from './channels/notification-channel';

/**
 * Unit-level checks on the emission fan-out: recipients are de-duplicated and
 * NULL/undefined dropped, one emit call per real recipient, and external
 * channels are invoked only for notifications actually created — a channel
 * throwing never propagates.
 */
describe('NotificationsService.emitWith', () => {
  const ctx: RlsContext = { userId: 'u1', role: 'partner', officeId: 'o1', employeeId: 'e-actor' };
  const inactiveCls = { isActive: () => false } as unknown as ClsService;
  const db = {} as DatabaseService;

  /** A fake client whose emit_notification returns a user id derived from the employee arg. */
  function fakeClient(created: (employeeId: string) => string | null): {
    client: PoolClient;
    calls: unknown[][];
  } {
    const calls: unknown[][] = [];
    const client = {
      query: (_sql: string, params: unknown[]) => {
        calls.push(params);
        const employeeId = params[0] as string;
        return Promise.resolve({ rows: [{ recipient_user_id: created(employeeId) }] });
      },
    } as unknown as PoolClient;
    return { client, calls };
  }

  it('de-duplicates recipients, drops null/undefined, and counts only created rows', async () => {
    const delivered: OutboundNotification[] = [];
    const channel: NotificationChannel = {
      name: 'fake',
      deliver: async (n) => {
        delivered.push(n);
      },
    };
    const service = new NotificationsService(db, inactiveCls, [channel]);
    const { client, calls } = fakeClient((emp) => (emp === 'e-nouser' ? null : `user-${emp}`));

    const created = await service.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.taskAssigned,
      recipientEmployeeIds: ['e1', 'e1', null, undefined, 'e2', 'e-nouser'],
      title: 'Assigned',
    });

    // e1 (once), e2, e-nouser → 3 emit calls; e-nouser returns no user → 2 created.
    expect(calls).toHaveLength(3);
    expect(created).toBe(2);
    // External delivery only for the two created notifications.
    expect(delivered.map((d) => d.recipientUserId).sort()).toEqual(['user-e1', 'user-e2']);
  });

  it('never lets a failing channel propagate (best-effort delivery)', async () => {
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
