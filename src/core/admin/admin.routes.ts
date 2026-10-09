import { Config } from 'src/config';
import { AnimeIndexer } from 'src/core/anime/helpers/anime.indexer';
import lock from 'src/helpers/lock';
import { ForbiddenError, UnauthorizedError } from 'src/helpers/errors';
import { createSuccessResponse } from 'src/helpers/response';
import { getApiKey } from 'src/helpers/utils';
import redisClient from 'src/lib/redis';
import Elysia, { t } from 'elysia';
import { freemem, loadavg, totalmem } from 'node:os';
import { execSync } from 'node:child_process';

/** Admin-only guard for /admin/* routes. */
const requireAdmin = (request: Request) => {
  if (!Config.admin_key) {
    throw new ForbiddenError('Admin API is disabled: set ADMIN_KEY in your .env to enable it');
  }

  const key = getApiKey(request);

  if (
    !key ||
    key.length !== Config.admin_key.length ||
    !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(Config.admin_key))
  ) {
    throw new UnauthorizedError('Invalid admin key');
  }
};

const diskFreeGb = (): number | null => {
  try {
    const out = execSync('df -k / | tail -1', { timeout: 5000 }).toString().trim().split(/\s+/);
    const availKb = Number(out[3]);
    return Number.isFinite(availKb) ? Math.round((availKb / 1048576) * 10) / 10 : null;
  } catch {
    return null;
  }
};

const adminRoute = () => {
  return (app: Elysia) =>
    app.group('/admin', { tags: ['Admin'] }, (app) =>
      app.get('/stats', async ({ request }) => {
        requireAdmin(request);

        let redis: { used_memory_human: string | null } | null = null;
        if (redisClient) {
          const info = await redisClient.info('memory');
          const match = info.match(/used_memory_human:(.+)/);
          redis = { used_memory_human: match?.[1]?.trim() ?? null };
        }

        const indexerState = await AnimeIndexer.getState();

        return createSuccessResponse({
          message: 'Stats',
          data: {
            redis,
            vps: {
              loadavg_1m: loadavg()[0] ?? null,
              mem_total_mb: Math.round(totalmem() / 1048576),
              mem_free_mb: Math.round(freemem() / 1048576),
              disk_free_gb: diskFreeGb()
            },
            indexer: {
              running: lock.isLocked('indexer'),
              last_page: indexerState?.last_page ?? null,
              last_pl: indexerState?.last_pl ?? null
            }
          }
        });
      }, {
        detail: {
          summary: 'Admin stats',
          description: 'Redis memory, VPS stats and indexer progress. Requires admin key in x-api-key header.'
        },
        headers: t.Object({ 'x-api-key': t.String() })
      })

      .post('/indexer/backfill-shikimori', async ({ request }) => {
        requireAdmin(request);

        return createSuccessResponse({
          message: await AnimeIndexer.backfillShikimori()
        });
      }, {
        detail: {
          summary: 'Backfill Shikimori data',
          description: 'Phase 2 of the two-phase index: fills Shikimori videos/screenshots/posters/franchise for every anime already in the DB. Requires USE_SHIKIMORI=true and admin key in x-api-key header. Runs in the background under the indexer lock.'
        },
        headers: t.Object({ 'x-api-key': t.String() })
      })
    );
};

export { adminRoute };
