import { inSequence } from './in-sequence';

describe('inSequence', () => {
  it('runs each step only after the previous one settled, keeping the order', async () => {
    const log: string[] = [];
    const step = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      return name;
    };
    const [a, b] = await inSequence(step('a', 10), step('b', 0));
    expect([a, b]).toEqual(['a', 'b']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('stops at the first failure', async () => {
    const second = jest.fn(async () => 2);
    await expect(
      inSequence(async () => {
        throw new Error('boom');
      }, second),
    ).rejects.toThrow('boom');
    expect(second).not.toHaveBeenCalled();
  });
});
