import { db } from 'src/db';
import { mappings } from 'src/db/schema';
import { Config } from 'src/config';
import { getKey, Redis } from 'src/helpers/redis.util';
import { ProviderModule } from 'src/helpers/module';
import { parseNumber } from 'src/helpers/parsers';
import { AnizipFetch } from './helpers/anizip.fetch';
import { AniZipResponse } from './types';

class AnizipModule extends ProviderModule<AniZipResponse> {
  override readonly name = 'Anizip';

  override async getInfo(id: number): Promise<AniZipResponse> {
    return this.getMappings(id);
  }

  async getMappings(anilistId: number): Promise<AniZipResponse> {
    if (!Config.use_anizip) {
      throw new Error(`${this.name} disabled`);
    }

    const key = getKey(this.name, 'mappings', anilistId);

    const cached = await Redis.get<AniZipResponse>(key);

    if (cached) {
      return cached;
    }

    const stored = await this.fromDb(anilistId);

    if (stored) {
      await Redis.set(key, stored);
      return stored;
    }

    const fresh = await AnizipFetch.fetchMappings(anilistId);

    await this.save(anilistId, fresh);
    await Redis.set(key, fresh);

    return fresh;
  }

  private async fromDb(anilistId: number): Promise<AniZipResponse | null> {
    const row = await db.query.mappings.findFirst({
      where: { anilist_id: anilistId }
    });

    if (!row) {
      return null;
    }

    return {
      mappings: {
        anilist_id: row.anilist_id,
        mal_id: row.mal_id ?? undefined,
        kitsu_id: row.kitsu_id ?? undefined,
        anidb_id: row.anidb_id ?? undefined,
        thetvdb_id: row.tvdb_id ?? undefined,
        themoviedb_id: row.tmdb_id != null ? String(row.tmdb_id) : undefined
      },
      episodes: row.episodes ?? undefined
    };
  }

  private async save(anilistId: number, payload: AniZipResponse) {
    const m = payload.mappings;

    const values = {
      anilist_id: anilistId,
      mal_id: parseNumber(m?.mal_id),
      kitsu_id: parseNumber(m?.kitsu_id),
      anidb_id: parseNumber(m?.anidb_id),
      tvdb_id: parseNumber(m?.thetvdb_id),
      tmdb_id: parseNumber(m?.themoviedb_id),
      episodes: payload.episodes ?? null,
      updated_at: new Date()
    };

    await db.insert(mappings).values(values).onConflictDoUpdate({
      target: mappings.anilist_id,
      set: values
    });
  }
}

const Anizip = new AnizipModule();

export { Anizip, AnizipModule };
