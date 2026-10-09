import 'reflect-metadata';
import './helpers/self.poll';

import { createErrorResponse, createSuccessResponse } from './helpers/response';
import { HttpError } from './helpers/errors';
import { Config } from './config/config';import rateLimit from './helpers/plugins/rate.limit';
import protectRoute from './helpers/plugins/protect.route';
import { adminRoute, animeIndexerRoute, animeRoute, animeUpdateRoute, apiRoute, mappingsRoute, yoga } from './core';
import logger from './helpers/logger';
import Elysia, { file, NotFoundError, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import swagger from '@elysiajs/swagger';
import { db } from './db';
import { sql } from 'drizzle-orm';
import staticPlugin from '@elysiajs/static';
import { AnimeIndexer } from './core/anime/helpers/anime.indexer';

/**
 * Process-level safety net.
 *
 * The postgres driver can surface errors OUTSIDE any promise chain — e.g.
 * when Neon's pooler kills a socket mid-write, the driver's socket 'close'
 * handler throws synchronously through node:events. No try/catch in the
 * indexer (or anywhere in request handling) can intercept that; without
 * these handlers one such error takes down the whole API *and* leaves the
 * indexer dead until someone manually restarts it.
 *
 * We log loudly and keep running instead. The indexer itself is idempotent
 * (resumes from indexer_state, skips existing anime) and its per-item work
 * is retried (see withDbRetry), so surviving is the correct call here.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('[process] Unhandled promise rejection — process survived:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('[process] Uncaught exception — process survived:', err);
});

const app = new Elysia()
  .use(
    cors({
      origin: Config.cors,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false
    })
  )
  .use(staticPlugin())
  .use(
    protectRoute((request) => {
      const path = new URL(request.url).pathname;

      if (Config.routes_whitelist.includes(path)) return true;
      if (Config.routes_blacklist.includes(path)) return false;

      return Config.api_strategy === 'not_required';
    })
  )
  .use(rateLimit(Config.rate_limit, Config.rate_limit_ttl))
  .use(
    swagger({
      path: '/docs',
      specPath: '/docs/openapi',
      documentation: {
        info: {
          title: 'Kuroji API',
          description: 'Public documentation for the Kuroji API.',
          version: '1.0.0'
        },
        servers: [
          {
            url: Config.public_url,
            description: 'Production server'
          }
        ],
        components: {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              in: 'header',
              name: 'x-api-key',
              description: 'API key'
            }
          }
        },
        security: [{ apiKey: [] }],
        tags: [
          {
            name: 'Anime',
            description: 'Anime REST endpoints'
          },
          {
            name: 'Anime Indexer',
            description: 'Anime Indexer REST endpoints'
          },
          {
            name: 'Anime Update',
            description: 'Anime Update REST endpoints'
          },
          {
            name: 'Mappings',
            description: 'Self-hosted AniZip mappings REST endpoints'
          },
          {
            name: 'API',
            description: 'Main REST endpoints'
          },
          {
            name: 'System',
            description: 'System endpoints'
          },
          {
            name: 'GraphQL',
            description: 'GraphQL endpoints'
          }
        ]
      }
    })
  )
  .onError(({ error, set }) => {
    if (error instanceof NotFoundError) {
      set.status = 404;
      return createErrorResponse({
        error: { status: 404, message: 'Route not found', details: `Docs: ${Config.public_url}/docs` }
      });
    }

    if (error instanceof HttpError) {
      set.status = error.status;
      return createErrorResponse({
        error: { status: error.status, message: error.message, details: error.details }
      });
    }

    if (error instanceof Error) {
      set.status = 500;
      return createErrorResponse({
        error: { status: 500, message: error.message, details: error.stack }
      });
    }

    set.status = 500;
    return createErrorResponse({ error: { status: 500, message: 'Unknown error' } });
  });

app.use(animeRoute());
app.use(animeIndexerRoute());
app.use(animeUpdateRoute());
app.use(apiRoute());
app.use(mappingsRoute());
app.use(adminRoute());

app.get('/graphql', ({ request }) => yoga.handle(request), {
  tags: ['GraphQL'],
  detail: {
    summary: 'GraphQL Playground',
    description: 'GraphiQL UI for graphql'
  }
});

app.post('/graphql', ({ request }) => yoga.handle(request), {
  tags: ['GraphQL'],
  detail: {
    summary: 'GraphQL',
    description: 'The graphql'
  }
});

app.get('/', () => file('public/html/index.html'), {
  detail: {
    summary: 'Home Page',
    description: 'The home page of the API'
  }
});

app.get('/info', () => file('public/html/info.html'), {
  query: t.Object({
    id: t.Number()
  }),
  detail: {
    summary: 'Info Page',
    description: 'The info page of the API'
  }
});

app.get(
  '/logs',
  ({ query }) => {
    const logs = logger.getLogsPaginated(query.page, query.per_page);

    return createSuccessResponse({ message: 'Logs got', data: logs });
  },
  {
    tags: ['System'],
    query: t.Object({
      page: t.Optional(t.Number({ default: 1 })),
      per_page: t.Optional(t.Number({ default: 50, maximum: 100 }))
    }),
    detail: {
      summary: 'Logs',
      description: 'Returns logs from logger'
    }
  }
);

app.get(
  '/state',
  async () => {
    const uptime = (): string => {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      return `${hours}h ${minutes}m ${seconds}s`;
    };

    const size = (await db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size;`)) as {
      size: string;
    }[];

    const memory = process.memoryUsage();

    const dbHealthy = await db.execute(sql`SELECT 1`);

    return createSuccessResponse({
      message: 'State of API',
      data: {
        uptime: uptime(),
        db: {
          size: size[0]?.size,
          healthy: dbHealthy ? true : false
        },
        memory: {
          rss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
          heap_total: `${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          heap_used: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          external: `${(memory.external / 1024 / 1024).toFixed(2)} MB`
        }
      }
    });
  },
  {
    tags: ['System'],
    detail: {
      summary: 'State',
      description: 'Returns system state'
    }
  }
);

app.get(
  '/health',
  async () => {
    await db.execute(sql`SELECT 1`);

    return createSuccessResponse({
      message: 'Service is healthy',
      data: { status: 'UP' }
    });
  },
  {
    tags: ['System'],
    detail: {
      summary: 'Health Check',
      description: 'Returns the health status of the application and its dependencies'
    }
  }
);

app.listen({ port: Config.port });

logger.log(`Server listening on port ${Config.port}, at ${Config.public_url}`);

// Auto-resume the indexer on boot (e.g. after a crash + systemd restart).
// Safe: the indexer resumes from indexer_state.last_page and skips anime
// already in the DB, and start() respects the indexer lock so it can never
// double-start (e.g. if it was already triggered via the API).
if (Config.indexer_autostart) {
  logger.log('Indexer autostart enabled, resuming...');
  AnimeIndexer.start({})
    .then((msg) => logger.log(`Indexer autostart: ${msg}`))
    .catch((err) => logger.error('Indexer autostart failed:', err));
} else {
  logger.log('Indexer autostart disabled (INDEXER_AUTOSTART=false)');
}
