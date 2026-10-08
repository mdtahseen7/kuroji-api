import { parseString } from 'src/helpers/parsers';
import { JikanAnimeFull } from './types';
import { getKey, Redis } from 'src/helpers/redis.util';
import { JikanFetch } from './helpers/jikan.fetch';
import { ProviderModule } from 'src/helpers/module';
import { Anime } from '../../anime';
import {
  AnimeGenrePayload,
  AnimeImagePayload,
  AnimeOtherDescriptionPayload,
  AnimeOtherTitlePayload,
  AnimeStudioConnectionPayload
} from '../../types';
import { ISO_639_1 } from 'src/helpers/languages';
import { sleep } from 'bun';
import { Config } from 'src/config';

// Jikan allows 3 req/sec — stay comfortably under at ~2 req/sec.
const MIN_INTERVAL_MS = 500;
let lastCall = 0;

class JikanModule extends ProviderModule<JikanAnimeFull> {
  override readonly name = 'Jikan';

  private async throttle() {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) {
      await sleep(wait);
    }
    lastCall = Date.now();
  }

  override async getInfo(id: number, idMal?: number): Promise<JikanAnimeFull> {
    if (!Config.use_jikan) {
      throw new Error(`${this.name} disabled`);
    }

    const key = getKey(this.name, 'info', id);

    const cached = await Redis.get<JikanAnimeFull>(key);

    if (cached) {
      return cached;
    }

    const info = await this.resolveInfo(id, idMal);

    if (info.title_english) {
      const other_titles: AnimeOtherTitlePayload = {
        title: info.title_english,
        source: this.name,
        language: ISO_639_1.EN
      };
      await Anime.save({ id, other_titles });
    }

    if (info.title_japanese) {
      const other_titles: AnimeOtherTitlePayload = {
        title: info.title_japanese,
        source: this.name,
        language: ISO_639_1.JA
      };
      await Anime.save({ id, other_titles });
    }

    if (info.title_synonyms?.length) {
      for (const title of info.title_synonyms) {
        const other_titles: AnimeOtherTitlePayload = {
          title,
          source: this.name,
          language: ISO_639_1.EN
        };
        await Anime.save({ id, other_titles });
      }
    }

    if (info.synopsis) {
      const other_descriptions: AnimeOtherDescriptionPayload = {
        description: info.synopsis,
        source: this.name,
        language: ISO_639_1.EN
      };
      await Anime.save({ id, other_descriptions });
    }

    const jpg = info.images?.jpg;
    if (jpg?.image_url) {
      const images: AnimeImagePayload = {
        url: jpg.image_url,
        small: jpg.small_image_url,
        large: jpg.large_image_url,
        type: 'poster',
        source: this.name
      };
      await Anime.save({ id, images });
    }

    const genreNames = [
      ...(info.genres ?? []),
      ...(info.explicit_genres ?? []),
      ...(info.themes ?? []),
      ...(info.demographics ?? [])
    ]
      .map((g) => g.name)
      .filter((n): n is string => !!n);
    if (genreNames.length) {
      const genres: AnimeGenrePayload[] = [...new Set(genreNames)].map((name) => ({ name }));
      await Anime.save({ id, genres });
    }

    if (info.studios?.length) {
      const studios: AnimeStudioConnectionPayload[] = info.studios
        .filter((s) => s.mal_id)
        .map((s) => ({
          id: s.mal_id!,
          is_main: null,
          studio: {
            id: s.mal_id!,
            name: s.name ?? null
          }
        }));
      if (studios.length) {
        await Anime.save({ id, studios });
      }
    }

    if (info.score && info.score > 0) {
      await Anime.save({ id, score: info.score });
    }

    await Redis.set(key, info);

    return info;
  }

  private async resolveInfo(id: number, idMal?: number) {
    await this.throttle();

    if (idMal) {
      const info = await JikanFetch.fetchFull(parseString(idMal)!);

      await Anime.save({
        id,
        links: {
          link: parseString(idMal)!,
          label: this.name,
          type: 'mapping'
        }
      });

      return info;
    }

    const idMap = await Anime.map(id, this.name);

    if (idMap) {
      return JikanFetch.fetchFull(idMap);
    }

    const al = await Anime.getBasicInfo(id);

    if (!al?.id_mal) {
      throw new Error('Anime not found');
    }

    const info = await JikanFetch.fetchFull(parseString(al.id_mal)!);

    await Anime.save({
      id,
      links: {
        link: parseString(al.id_mal)!,
        label: this.name,
        type: 'mapping'
      }
    });

    return info;
  }
}

const Jikan = new JikanModule();

export { Jikan, JikanModule };
