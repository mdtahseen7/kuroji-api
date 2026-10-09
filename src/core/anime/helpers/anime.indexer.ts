import lock from 'src/helpers/lock';
import { sleep } from 'bun';
import logger from 'src/helpers/logger';
import { EnableSchedule, Scheduled, Schedule } from 'src/helpers/schedule';
import { Config } from 'src/config';
import { AnilistFetch, AnilistMedia, AnilistUtils, Shikimori } from '../providers';
import { Anime } from '../anime';
import { Module } from 'src/helpers/module';
import { forEachConcurrent } from 'src/helpers/concurrency';
import { anime, db, indexerState } from 'src/db';
import { sql } from 'drizzle-orm';

@EnableSchedule
class AnimeIndexerModule extends Module {
  override readonly name = 'AnimeIndexer';

  private async index(options: { delay?: number; status?: string; threshold?: number } = {}): Promise<void> {
    if (!lock.acquire('indexer')) {
      logger.log('Indexer already running, skipping new run.');
      return;
    }

    const { delay = Config.anime_processing_delay, status } = options;

    try {
      const state = await this.getState(status);
      let page = state?.last_page ?? 1;
      let hasNextPage = true;
      let failedCount = 0;
      let popularityLesser: number | undefined = state?.last_pl ?? undefined;

      const perPage = 50;
      const maxFails = 3;
      const maxTries = 3;

      logger.log(`Starting index from page ${page}...`);

      while (hasNextPage) {
        logger.log(`Fetching anime from page ${page}...`);

        let response;
        let currentTry = 0;

        while (currentTry < maxTries) {
          try {
            response = await AnilistFetch.fetchInfoBulk(page, perPage, {
              ...options,
              threshold_lesser: popularityLesser
            });
            failedCount = 0;
            break;
          } catch (err) {
            logger.error(`Failed to fetch page ${page}:`, err);
            currentTry++;

            if (currentTry < maxTries) {
              await sleep(240 * 1000);
            }
          }
        }

        if (currentTry >= maxTries) {
          failedCount++;

          if (failedCount >= maxFails) {
            logger.error('Too many failed, exiting');
            return;
          }

          page++;
          await this.setState(page, popularityLesser, status);
          continue;
        }

        if (!response) {
          logger.error('No response from anilist api');
          return;
        }

        hasNextPage = response.pageInfo.hasNextPage;

        const concurrency = Config.anime_index_concurrency;

        logger.log(
          `Indexing ${response.media.length} anime from page ${page} with concurrency ${concurrency}...`
        );

        const { failed } = await forEachConcurrent(
          response.media,
          concurrency,
          (media) => this.processAnime(media, delay),
          'anime'
        );

        if (!lock.isLocked('indexer')) {
          logger.log('Indexing stopped.');
          return;
        }

        if (failed > 0) {
          logger.log(`${failed} anime failed on page ${page}, continuing to next page...`);
        }

        page++;

        if (page > 100) {
          const popularity = response.media[response.media.length - 1]?.popularity;

          if (popularity && popularity !== popularityLesser) {
            popularityLesser = response.media[response.media.length - 1]?.popularity;
            page = 1;
          }
        }

        await this.setState(page, popularityLesser, status);
      }

      if (!hasNextPage) {
        await this.setState(1, undefined, status);
      }

      logger.log('Indexing complete. All done');
    } catch (err) {
      logger.error('Unexpected error during indexing:', err);
    } finally {
      lock.release('indexer');
    }
  }

  /**
   * Index a single anime. Runs inside the page worker pool.
   *
   * Existing-anime semantics (auto_update flag, defaults to true):
   * - not in DB -> full saveAndInit through all enabled providers
   * - in DB + auto_update=true -> re-saved (refresh), providers served from
   *   Redis cache when warm
   * - in DB + auto_update=false -> skipped entirely ("Wont update")
   *
   * A rejection here is caught by forEachConcurrent: it is logged and counted
   * but never aborts the other workers or the page.
   */
  private async processAnime(media: AnilistMedia, delay: number): Promise<void> {
    if (!lock.isLocked('indexer')) {
      return;
    }

    logger.log(`Indexing anime: ${media.id}...`);

    if (await Anime.exists(media.id)) {
      if (await Anime.shouldAutoUpdate(media.id)) {
        await Anime.saveAndInit(AnilistUtils.anilistToAnimePayload(media));
      } else {
        logger.log(`Wont update anime: ${media.id}...`);
      }
    } else {
      await Anime.saveAndInit(AnilistUtils.anilistToAnimePayload(media));
    }

    await sleep(delay * 1000);
  }

  public async start(options: { delay?: number; status?: string; threshold?: number }): Promise<string> {
    if (lock.isLocked('indexer')) {
      logger.log('Indexer already running, skipping new run.');
      return 'Indexer already running';
    }

    logger.log('Starting indexing...');
    this.index(options).catch((err) => {
      logger.error('Error during indexing:', err);
    });

    return `Indexing started, estimated time: ${await this.calculateEstimatedTime(options)}`;
  }

  public stop(): string {
    if (lock.isLocked('indexer')) {
      logger.log('Indexing stopped by request.');
      lock.release('indexer');
      return 'Indexing stopped';
    }

    return 'Nothing to stop';
  }

  public reset(status?: string): string {
    logger.log('Indexer had been reseted');
    lock.release('indexer');
    this.setState(1, undefined, status);
    return 'Reseted indexer';
  }

  /**
   * Phase 2 of the two-phase index strategy: fill Shikimori-only data
   * (videos/trailers, screenshots, posters, franchise chronology) for every
   * anime already in the DB.
   *
   * Intended flow: run a full index pass with USE_SHIKIMORI=false (fast),
   * then set USE_SHIKIMORI=true, restart, and hit this. Shikimori.getInfo()
   * saves everything straight to the DB itself, so this touches Shikimori
   * only — no other provider is re-fetched.
   *
   * Runs in the background under the shared 'indexer' lock, so it is mutually
   * exclusive with a normal index run and stoppable via the regular stop
   * endpoint.
   */
  public async backfillShikimori(): Promise<string> {
    if (!Config.use_shikimori) {
      return 'USE_SHIKIMORI is disabled — enable it and restart before running the backfill';
    }

    if (!lock.acquire('indexer')) {
      logger.log('Indexer already running, skipping Shikimori backfill.');
      return 'Indexer already running';
    }

    logger.log('Starting Shikimori backfill...');
    this.runBackfillShikimori().catch((err) => {
      logger.error('Error during Shikimori backfill:', err);
    });

    return 'Shikimori backfill started';
  }

  private async runBackfillShikimori(): Promise<void> {
    try {
      const rows = await db.select({ id: anime.id, idMal: anime.id_mal }).from(anime);

      logger.log(`Backfilling Shikimori data for ${rows.length} anime...`);

      const concurrency = Config.anime_index_concurrency;
      const delay = Config.anime_processing_delay;

      const { failed } = await forEachConcurrent(
        rows,
        concurrency,
        async (row) => {
          if (!lock.isLocked('indexer')) {
            return;
          }

          logger.log(`Backfilling Shikimori for anime: ${row.id}...`);
          await Shikimori.getInfo(row.id, row.idMal ?? undefined);
          await sleep(delay * 1000);
        },
        'anime'
      );

      if (!lock.isLocked('indexer')) {
        logger.log('Shikimori backfill stopped.');
        return;
      }

      logger.log(`Shikimori backfill complete. ${rows.length - failed}/${rows.length} succeeded.`);
    } catch (err) {
      logger.error('Unexpected error during Shikimori backfill:', err);
    } finally {
      lock.release('indexer');
    }
  }

  @Scheduled(Schedule.everyOtherMonth(), Config.anime_reindexing_enabled)
  async scheduleIndex() {
    await this.index();
  }

  @Scheduled(Schedule.everyOtherDay(), Config.anime_reindexing_enabled)
  async scheduleIndexReleasing() {
    await this.index({ status: 'RELEASING' });
  }

  @Scheduled(Schedule.weeklyOn(6), Config.anime_reindexing_enabled)
  async scheduleIndexUpcoming() {
    await this.index({
      status: 'NOT_YET_RELEASED',
      threshold: Config.anime_popularity_threshold_upcoming
    });
  }

  public async calculateEstimatedTime(options: {
    delay?: number;
    status?: string;
    threshold?: number;
  }): Promise<string> {
    const { delay = Config.anime_processing_delay, status } = options;

    const fetched = ((await this.getState(status))?.last_page ?? 0) * 50;

    // Estimating count because anilist fixed the way i used to get count in anilist api
    const total = this.estimateCount(options);

    const remaining = Math.max(total - fetched, 0);

    const timeS = (remaining * (delay + 10)) / Math.max(1, Config.anime_index_concurrency);
    const timeM = Math.floor(timeS / 60);
    const timeH = Math.floor(timeM / 60);
    const timeD = Math.floor(timeH / 24);

    return `${timeD} days, ${timeH % 24} hours, ${timeM % 60} minutes, ${timeS % 60} seconds`;
  }

  private estimateCount(options: { status?: string; threshold?: number } = {}): number {
    const { status, threshold = Config.anime_popularity_threshold } = options;

    const buckets: [number, number][] = [
      [50_000, 300],
      [30_000, 700],
      [20_000, 1_400],
      [10_000, 2_800],
      [7_500, 4_000],
      [5_000, 5_800],
      [2_500, 9_500],
      [1_000, 14_500],
      [500, 18_500],
      [100, 24_000]
    ];

    const statusRatio: Record<string, number> = {
      FINISHED: 0.63,
      RELEASING: 0.13,
      NOT_YET_RELEASED: 0.09,
      CANCELLED: 0.07,
      HIATUS: 0.01
    };

    if (threshold >= buckets[0]![0]) {
      return Math.round(buckets[0]![1] * (status ? (statusRatio[status] ?? 1) : 1));
    }

    if (threshold <= buckets[buckets.length - 1]![0]) {
      return Math.round(buckets[buckets.length - 1]![1] * (status ? (statusRatio[status] ?? 1) : 1));
    }

    for (let i = 0; i < buckets.length - 1; i++) {
      const [p1, c1] = buckets[i] ?? [0, 0];
      const [p2, c2] = buckets[i + 1] ?? [0, 0];

      if (threshold <= p1 && threshold >= p2) {
        const t = (threshold - p1) / (p1 - p2);
        const value = c1 + t * (c1 - c2);

        return Math.round(value * (status ? (statusRatio[status] ?? 1) : 1));
      }
    }

    return 0;
  }

  async getState(status?: string) {
    return db.query.indexerState.findFirst({
      where: {
        id: `anime-${status ? status.toLowerCase() : 'all'}`
      }
    });
  }

  async setState(page: number, pl?: number, status?: string): Promise<void> {
    await db
      .insert(indexerState)
      .values({
        id: `anime-${status ? status.toLowerCase() : 'all'}`,
        last_pl: pl,
        last_page: page
      })
      .onConflictDoUpdate({
        target: indexerState.id,
        set: {
          last_pl: sql`excluded.last_pl`,
          last_page: sql`excluded.last_page`
        }
      });
  }
}

const AnimeIndexer = new AnimeIndexerModule();

export { AnimeIndexer, AnimeIndexerModule };
