type Step = () => unknown;

/**
 * Run reads that share one `PoolClient` one after another, keeping the tuple
 * types of `Promise.all`. A pg client executes one query at a time anyway, so
 * this costs nothing; issuing them together is deprecated (pg@9 rejects it).
 */
export async function inSequence<const T extends readonly Step[]>(
  ...steps: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const step of steps) out.push(await step());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
