import logger from './logger';

/**
 * Run `fn` over `items` with at most `concurrency` async workers in flight.
 *
 * Workers pull the next item by a shared index counter. Because JS runs the
 * synchronous slice between two awaits atomically, the counter increment
 * needs no lock.
 *
 * A rejection in `fn` for one item is logged and counted but never stops the
 * other workers and never aborts the run — callers that need page-level
 * resume semantics (like the anime indexer) can safely commit progress for
 * the items that succeeded.
 *
 * Resolves with the number of items whose `fn` rejected.
 */
async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  label = 'item'
): Promise<{ failed: number }> {
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));

  let next = 0;
  let failed = 0;

  const workers: Promise<void>[] = [];

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const i = next++;

          if (i >= items.length) {
            return;
          }

          try {
            await fn(items[i]!, i);
          } catch (err) {
            failed++;
            logger.error(`[concurrency] ${label} at index ${i} failed:`, err);
          }
        }
      })()
    );
  }

  await Promise.all(workers);

  return { failed };
}

export { forEachConcurrent };
