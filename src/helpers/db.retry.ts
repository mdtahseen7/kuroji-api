import { sleep } from 'bun';
import logger from './logger';

/**
 * Patterns identifying transient database/infrastructure errors that are
 * worth retrying: dropped pooler connections (Neon), socket resets,
 * timeouts, DNS blips, and Postgres connection-class SQLSTATEs.
 *
 * Anything not matching is treated as permanent and fails fast (no
 * pointless retries) — but it still never crashes the caller, see
 * withDbRetry.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /CONNECTION_CLOSED/i,
  /CONNECTION_RESET/i,
  /CONNECTION_DESTROYED/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /EPIPE/i,
  /\btimeout\b/i,
  /\bpool/i,
  // Postgres SQLSTATE connection errors
  /\b08000\b/, // connection_exception
  /\b08003\b/, // connection_does_not_exist
  /\b08006\b/, // connection_failure
  /\b57P01\b/, // admin_shutdown
  /\b57P02\b/, // crash_shutdown
  /\b53300\b/ // too_many_connections
];

/**
 * Walk an error and its cause chain (Drizzle wraps driver errors as
 * DrizzleQueryError.cause) looking for a transient signature.
 */
function isTransientDbError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current && !seen.has(current)) {
    seen.add(current);

    const code = (current as { code?: unknown }).code;
    const errno = (current as { errno?: unknown }).errno;
    const message = (current as { message?: unknown }).message;

    for (const hay of [code, errno, message]) {
      if (typeof hay === 'string' && TRANSIENT_PATTERNS.some((p) => p.test(hay))) {
        return true;
      }
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

const RETRY_BACKOFF_MS = [2000, 8000, 20000];

/**
 * Run `fn`, retrying transient database errors with backoff.
 *
 * - Up to `maxAttempts` total tries (default 3), sleeping ~2s/8s/20s between.
 * - Non-transient errors fail immediately (no pointless retries).
 * - If every attempt fails, the error is logged with `label` and re-thrown.
 *   Callers inside the indexer worker pool (forEachConcurrent) catch it
 *   per-item, so one bad anime is logged + counted but never stops the run
 *   or kills the process.
 *
 * Safe to wrap whole per-anime units: the indexer's writes are upserts /
 * existence checks, i.e. idempotent, so a retried unit can't duplicate data.
 */
async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  const attempts = Math.max(1, maxAttempts);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const transient = isTransientDbError(err);
      const isLast = attempt >= attempts;

      if (!transient || isLast) {
        logger.error(
          `[db-retry] ${label}: ${
            transient ? `gave up after ${attempt} attempts` : 'non-transient error, not retrying'
          }:`,
          err
        );
        throw err;
      }

      const waitMs = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!;
      logger.log(
        `[db-retry] ${label}: transient DB error (attempt ${attempt}/${attempts}), retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }

  // Unreachable (loop always throws on the last attempt), keeps tsc happy.
  throw lastErr;
}

export { withDbRetry, isTransientDbError };
