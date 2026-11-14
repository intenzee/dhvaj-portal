import type { CronJob } from 'cron';
import { ActivityService } from '../../common/activity/activity.service';
import { ComplianceSchedulerService, OUTBOX_KICK_MS } from './compliance-scheduler.service';

/**
 * The outbox drain never queries for no one: its 5-minute tick runs only after
 * people used the portal (or on the hour, after the sweep), and a change has
 * its e-mail sent ~30 s later, a burst sharing one drain.
 */
describe('ComplianceSchedulerService — idle-aware outbox', () => {
  let jobs: Map<string, CronJob>;
  let runExclusive: jest.Mock;
  let activity: ActivityService;
  let scheduler: ComplianceSchedulerService;
  let drained: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 16, 10, 7)); // not on the hour
    jobs = new Map();
    runExclusive = jest.fn(async (_name: string, work: () => Promise<unknown>) => ({
      ran: true,
      result: await work(),
    }));
    activity = new ActivityService();
    const config = {
      get: (k: string) => (k === 'SCHEDULER_ENABLED' ? true : '*/5 * * * *'),
    };
    const registry = {
      addCronJob: (name: string, job: CronJob) => jobs.set(name, job),
    };
    scheduler = new ComplianceSchedulerService(
      { runExclusive } as never,
      config as never,
      registry as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      activity,
    );
    drained = jest.spyOn(scheduler, 'runOutboxDrain').mockResolvedValue(undefined);
    scheduler.onModuleInit();
    for (const j of jobs.values()) void j.stop();
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
  });

  const tick = async (): Promise<void> => {
    await (
      jobs.get('notification-outbox-drain') as unknown as { fireOnTick(): unknown }
    ).fireOnTick();
    await Promise.resolve();
  };

  it('the first tick drains; with no one around since, the next does not even take the lock', async () => {
    await tick();
    expect(drained).toHaveBeenCalledTimes(1);
    // runOutboxDrain is mocked, so stamp its run as the real one would.
    (scheduler as unknown as { outboxRanAt: number }).outboxRanAt = Date.now();
    runExclusive.mockClear();
    jest.setSystemTime(new Date(2026, 10, 16, 10, 12));
    await tick();
    expect(runExclusive).not.toHaveBeenCalled();
  });

  it('a request since the last run brings the tick back', async () => {
    (scheduler as unknown as { outboxRanAt: number }).outboxRanAt = Date.now();
    jest.setSystemTime(new Date(2026, 10, 16, 10, 9));
    activity.touch(false);
    jest.setSystemTime(new Date(2026, 10, 16, 10, 12));
    await tick();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it('on the hour it drains regardless', async () => {
    (scheduler as unknown as { outboxRanAt: number }).outboxRanAt = Date.now();
    jest.setSystemTime(new Date(2026, 10, 16, 11, 0));
    await tick();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it('a change sends its e-mail ~30 s later; a burst shares one drain; reads send nothing', async () => {
    activity.touch(false);
    jest.advanceTimersByTime(OUTBOX_KICK_MS + 1);
    expect(runExclusive).not.toHaveBeenCalled();
    activity.touch(true);
    activity.touch(true);
    jest.advanceTimersByTime(OUTBOX_KICK_MS - 1);
    expect(runExclusive).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    await Promise.resolve();
    expect(runExclusive).toHaveBeenCalledTimes(1);
    expect(runExclusive.mock.calls[0]![0]).toBe('notification-outbox-drain');
  });
});
