import type { PoolClient } from 'pg';
import {
  readFrameworkRecordInputsOn,
  withFrameworkInputsCacheOn,
} from './framework-summary-inputs';

/** A client whose every query returns no rows, counting the round trips. */
function fakeClient(): { client: PoolClient; calls: () => number } {
  let n = 0;
  const client = {
    query: jest.fn(async () => {
      n += 1;
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  return { client, calls: () => n };
}

describe('02.8 record inputs cache', () => {
  it('reads the inputs once per workflow instance inside a summary build', async () => {
    const { client, calls } = fakeClient();
    const once = await readFrameworkRecordInputsOn(client, 'wf1');
    const perRead = calls();
    expect(perRead).toBeGreaterThan(0);

    const before = calls();
    await withFrameworkInputsCacheOn(client, async () => {
      const a = await readFrameworkRecordInputsOn(client, 'wf1');
      const b = await readFrameworkRecordInputsOn(client, 'wf1');
      expect(b).toBe(a);
      expect(a).toEqual(once);
      await readFrameworkRecordInputsOn(client, 'wf2');
    });
    expect(calls() - before).toBe(perRead * 2);
  });

  it('ends with the build, so a later read sees new writes', async () => {
    const { client, calls } = fakeClient();
    await withFrameworkInputsCacheOn(client, () => readFrameworkRecordInputsOn(client, 'wf1'));
    const after = calls();
    await readFrameworkRecordInputsOn(client, 'wf1');
    expect(calls()).toBeGreaterThan(after);
  });
});
