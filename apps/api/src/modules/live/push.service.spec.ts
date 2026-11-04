import { LIVE_EVENT, isPushEndpoint } from '@hsdg/contracts';
import {
  productionConfigProblems,
  productionConfigWarnings,
  validateEnv,
} from '../../config/env.validation';
import { pushTopic, taskPushAlert, type TaskPush } from './push.service';

const at = new Date('2026-11-05T10:00:00.000Z');
const task: TaskPush = {
  kind: LIVE_EVENT.quickTaskAssigned,
  taskId: '912fb9e5-4129-4d1e-bf9d-bd4fffc93b3b',
  to: 'y',
  urgent: true,
  fromName: 'Partner A',
  taskTitle: 'Call the client about the GST notice',
};

describe('push alerts', () => {
  it('words a new task, its reminders and an answer', () => {
    expect(taskPushAlert(task, 0, at)).toEqual({
      kind: 'quick_task.assigned',
      taskId: task.taskId,
      title: '🔔 Urgent task from Partner A',
      body: 'Call the client about the GST notice',
      urgent: true,
      url: `/quick-tasks?t=${task.taskId}`,
      at: '2026-11-05T10:00:00.000Z',
      ring: 0,
    });
    expect(taskPushAlert({ ...task, urgent: false, fromName: null }, 0, at).title).toBe(
      '🔔 New task from Someone',
    );
    expect(taskPushAlert(task, 2, at).title).toBe('⏰ Still waiting — Urgent task from Partner A');
    const reply = taskPushAlert(
      {
        ...task,
        kind: LIVE_EVENT.quickTaskReply,
        fromName: 'Senior Y',
        line: 'Doing — Calling now',
      },
      0,
      at,
    );
    expect(reply.title).toBe('💬 Senior Y answered');
    expect(reply.body).toBe('Doing — Calling now · Call the client about the GST notice');
    expect(taskPushAlert({ ...task, taskTitle: 'x'.repeat(500) }, 0, at).body).toHaveLength(300);
  });

  it('gives each task one push topic of 32 URL-safe characters', () => {
    expect(pushTopic(task.taskId)).toBe('912fb9e541294d1ebf9dbd4fffc93b3b');
  });

  it('posts only to real push services over https', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://db5p.notify.windows.com/w/?token=abc',
    ])
      expect(isPushEndpoint(ok)).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:444/x',
      'https://user@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.test/x',
      'https://evilpush.services.mozilla.com.test/x',
      'https://push.services.mozilla.com/x',
      'https://169.254.169.254/latest',
      'not a url',
    ])
      expect(isPushEndpoint(bad)).toBe(false);
  });

  it('needs both VAPID keys or neither, and warns in production when push is off', () => {
    const base = {
      NODE_ENV: 'test',
      AUTH_JWT_SECRET: 'test-only-secret-at-least-16-chars',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    };
    const half = { ...base, WEB_PUSH_PUBLIC_KEY: 'B'.repeat(87) };
    expect(productionConfigProblems(validateEnv(half), half).join('\n')).toMatch(/set together/);
    expect(productionConfigProblems(validateEnv(base), base).join('\n')).not.toMatch(/WEB_PUSH/);
    expect(() => validateEnv({ ...base, WEB_PUSH_SUBJECT: 'ops@example.com' })).toThrow(
      /mailto: or https:/,
    );
    const env = validateEnv(base);
    expect(productionConfigWarnings(env).join('\n')).toMatch(/WEB_PUSH_PUBLIC_KEY/);
    expect(
      productionConfigWarnings(
        validateEnv({
          ...base,
          WEB_PUSH_PUBLIC_KEY: 'B'.repeat(87),
          WEB_PUSH_PRIVATE_KEY: 'p'.repeat(43),
        }),
      ).join('\n'),
    ).not.toMatch(/WEB_PUSH_PUBLIC_KEY/);
  });
});
