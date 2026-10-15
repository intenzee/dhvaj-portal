import { MonthlyDataRequestScheduler } from './monthly-data-request.scheduler';
import { raiseSlotRequests } from './client-chase';
import { DEFAULT_WORKFLOW_POLICY, workflowPolicy } from '../workflow-settings/workflow-policy';

jest.mock('./client-chase', () => ({
  ...jest.requireActual('./client-chase'),
  chasingPolicy: jest.fn().mockResolvedValue({ reminderDays: 7, escalationDays: 3 }),
  raiseSlotRequests: jest.fn(),
}));

jest.mock('../workflow-settings/workflow-policy', () => ({
  ...jest.requireActual('../workflow-settings/workflow-policy'),
  workflowPolicy: jest.fn(),
}));

const raise = raiseSlotRequests as jest.MockedFunction<typeof raiseSlotRequests>;
const policy = workflowPolicy as jest.MockedFunction<typeof workflowPolicy>;

const ctx = { userId: 'u1', role: 'managing_partner', officeId: 'o1' };
const filing = (id: string, email: string | null = 'accounts@bharat.test') => ({
  instance_id: id,
  engagement_id: `eng-${id}`,
  entity_name: 'Bharat Traders',
  form: 'GSTR-1',
  internal_due: '2026-10-08',
  client_email: email,
});

function build(opts: { due: ReturnType<typeof filing>[]; uploads: boolean }) {
  const queries: string[] = [];
  const client = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: opts.due };
    }),
  };
  const db = {
    withRlsContext: jest.fn((_ctx: unknown, fn: (c: unknown) => unknown) => fn(client)),
  };
  const config = {
    get: jest.fn((k: string) => (k === 'WEB_PUBLIC_URL' ? 'https://portal.test/' : false)),
  };
  const notifications = { enqueueClientDeliveryWith: jest.fn().mockResolvedValue(1) };
  let n = 0;
  const uploads = {
    enabled: opts.uploads,
    createLink: jest.fn(async () => ({ token: `tok${++n}` })),
  };
  const job = new MonthlyDataRequestScheduler(
    db as never,
    config as never,
    {} as never,
    notifications as never,
    uploads as never,
  );
  return { job, notifications, uploads, queries };
}

describe('MonthlyDataRequestScheduler (WF-302)', () => {
  beforeEach(() => {
    raise.mockReset();
    policy.mockResolvedValue(DEFAULT_WORKFLOW_POLICY);
  });

  it('raises requests filing by filing for last month and e-mails each filing once', async () => {
    const { job, notifications, uploads, queries } = build({
      due: [filing('a'), filing('b')],
      uploads: true,
    });
    raise
      .mockResolvedValueOnce([
        { dependencyId: 'd1', slotCode: 'SALES_REGISTER', label: 'Sales register' },
        { dependencyId: 'd2', slotCode: 'EWB_REPORT', label: 'E-way bill report' },
      ])
      .mockResolvedValueOnce([
        { dependencyId: 'd3', slotCode: 'PURCHASE_REGISTER', label: 'Purchase register' },
      ]);

    const res = await job.requestFor(ctx, '2026-10-01');

    expect(queries[0]).toContain('ci.section = ANY($3::text[])');
    expect(raise).toHaveBeenCalledTimes(2);
    expect(raise.mock.calls.map((c) => c[1])).toEqual(['a', 'b']);
    expect(raise.mock.calls[0]![2]).toMatchObject({ today: '2026-10-01', createdBy: null });
    expect(res).toEqual({
      periodKey: '2026-09',
      requested: 2,
      items: 3,
      linked: 3,
      emailed: 2,
      held: 0,
      failed: 0,
    });
    expect(uploads.createLink).toHaveBeenCalledTimes(3);
    expect(notifications.enqueueClientDeliveryWith).toHaveBeenCalledTimes(2);
    const first = notifications.enqueueClientDeliveryWith.mock.calls[0]![1];
    expect(first.title).toBe('Documents needed — GSTR-1 Sep 2026');
    expect(first.body).toContain('• Sales register: https://portal.test/client-upload/tok1');
    expect(first.body).toContain('• E-way bill report: https://portal.test/client-upload/tok2');
  });

  it('asks nothing when every slot was already asked for (idempotent re-run)', async () => {
    const { job, notifications, uploads } = build({
      due: [filing('a'), filing('b')],
      uploads: true,
    });
    raise.mockResolvedValue([]);

    const res = await job.requestFor(ctx, '2026-10-01');

    expect(res).toMatchObject({ requested: 0, items: 0, linked: 0, emailed: 0, failed: 0 });
    expect(uploads.createLink).not.toHaveBeenCalled();
    expect(notifications.enqueueClientDeliveryWith).not.toHaveBeenCalled();
  });

  it('keeps going past a filing that fails, and only raises when client upload is off', async () => {
    const { job, notifications, uploads } = build({
      due: [filing('a'), filing('b')],
      uploads: false,
    });
    raise
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        { dependencyId: 'd3', slotCode: 'PURCHASE_REGISTER', label: 'Purchase register' },
      ]);

    const res = await job.requestFor(ctx, '2026-10-01');

    expect(res).toMatchObject({ requested: 1, items: 1, linked: 0, emailed: 0, failed: 1 });
    expect(uploads.createLink).not.toHaveBeenCalled();
    expect(notifications.enqueueClientDeliveryWith).not.toHaveBeenCalled();
  });

  it.each(['whatsapp', 'copy'] as const)(
    'under the %s channel raises the requests but leaves the reminder to the team',
    async (channel) => {
      policy.mockResolvedValue({ ...DEFAULT_WORKFLOW_POLICY, clientReminderChannel: channel });
      const { job, notifications, uploads } = build({ due: [filing('a')], uploads: true });
      raise.mockResolvedValueOnce([
        { dependencyId: 'd1', slotCode: 'SALES_REGISTER', label: 'Sales register' },
      ]);

      const res = await job.requestFor(ctx, '2026-10-01');

      expect(res).toMatchObject({ requested: 1, items: 1, linked: 0, emailed: 0, held: 1 });
      expect(uploads.createLink).not.toHaveBeenCalled();
      expect(notifications.enqueueClientDeliveryWith).not.toHaveBeenCalled();
    },
  );
});
