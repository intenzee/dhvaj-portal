import { LIVE_EVENT, type QuickTaskSummary } from '@hsdg/contracts';
import { alertTitle, shouldKeepRinging } from '../alarm';
import {
  alertFromEvent,
  alertFromWaiting,
  alertKey,
  enqueueAlert,
  type TaskAlert,
} from '../task-alert';

const a = (over: Partial<TaskAlert> = {}): TaskAlert => ({
  taskId: 't1',
  kind: 'assigned',
  urgent: false,
  fromName: 'Partner A',
  at: '2026-11-05T10:00:00.000Z',
  ...over,
});

describe('task alerts', () => {
  it('rings on and on only for an urgent task or a tab out of sight, until touched', () => {
    expect(shouldKeepRinging({ urgent: true, hidden: false, touched: false })).toBe(true);
    expect(shouldKeepRinging({ urgent: false, hidden: true, touched: false })).toBe(true);
    expect(shouldKeepRinging({ urgent: false, hidden: false, touched: false })).toBe(false);
    expect(shouldKeepRinging({ urgent: true, hidden: true, touched: true })).toBe(false);
  });

  it('names the alert in the tab title', () => {
    expect(alertTitle({ kind: 'assigned', urgent: true, fromName: 'Partner A' })).toBe(
      '🔔 Urgent task from Partner A',
    );
    expect(alertTitle({ kind: 'assigned', urgent: false, fromName: null })).toBe(
      '🔔 New task from someone',
    );
    expect(alertTitle({ kind: 'reply', urgent: false, fromName: 'Senior Y' })).toBe(
      '💬 Senior Y answered',
    );
  });

  it('turns live events and waiting tasks into alerts', () => {
    expect(
      alertFromEvent({
        id: 'e1',
        kind: LIVE_EVENT.quickTaskReply,
        taskId: 't9',
        urgent: true,
        fromName: 'Senior Y',
        at: '2026-11-05T10:05:00.000Z',
      }),
    ).toEqual({
      taskId: 't9',
      kind: 'reply',
      urgent: true,
      fromName: 'Senior Y',
      at: '2026-11-05T10:05:00.000Z',
    });
    const w = {
      id: 't2',
      urgent: true,
      createdAt: '2026-11-05T09:00:00.000Z',
      assignedBy: { id: 'p', name: 'Partner A' },
    } as unknown as QuickTaskSummary;
    expect(alertFromWaiting(w)).toEqual({
      taskId: 't2',
      kind: 'assigned',
      urgent: true,
      fromName: 'Partner A',
      at: '2026-11-05T09:00:00.000Z',
    });
  });

  it('keeps one card per task, in arrival order', () => {
    let q = enqueueAlert([], a(), new Set());
    q = enqueueAlert(q, a({ taskId: 't2' }), new Set());
    expect(q.map((x) => x.taskId)).toEqual(['t1', 't2']);
    // The same new task heard again by polling changes nothing.
    expect(enqueueAlert(q, a({ at: '2026-11-05T10:00:01.000Z' }), new Set())).toBe(q);
  });

  it('a message on a new task keeps it a new task; urgency follows the task now', () => {
    const q = enqueueAlert(
      [a({ urgent: true })],
      a({ kind: 'reply', urgent: true, at: 'x' }),
      new Set(),
    );
    expect(q).toEqual([a({ kind: 'assigned', urgent: true, at: 'x' })]);
    // Cancelled meanwhile: the event says no longer urgent, so it stops ringing.
    expect(enqueueAlert(q, a({ kind: 'reply', urgent: false, at: 'y' }), new Set())).toEqual([
      a({ kind: 'assigned', urgent: false, at: 'y' }),
    ]);
  });

  it('a fresh answer replaces the older one; a finished task stops being urgent', () => {
    const first = a({ kind: 'reply', urgent: true, at: '1' });
    const q = enqueueAlert([first], a({ kind: 'reply', urgent: false, at: '2' }), new Set());
    expect(q).toEqual([a({ kind: 'reply', urgent: false, at: '2' })]);
  });

  it('a dismissed alert never comes back, however it arrives', () => {
    const dismissed = new Set([alertKey(a({ at: 'live-time' }))]);
    expect(enqueueAlert([], a({ at: 'created-time' }), dismissed)).toEqual([]);
    // A new answer after dismissing is a new alert.
    expect(enqueueAlert([], a({ kind: 'reply', at: 'later' }), dismissed)).toHaveLength(1);
  });
});
