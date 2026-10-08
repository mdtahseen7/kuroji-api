import { integer, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';
import type { AniZipEpisode } from 'src/core/anime/providers/anizip/types';

export const mappings = pgTable('mappings', {
  anilist_id: integer('anilist_id').primaryKey(),
  mal_id: integer('mal_id'),
  kitsu_id: integer('kitsu_id'),
  anidb_id: integer('anidb_id'),
  tvdb_id: integer('tvdb_id'),
  tmdb_id: integer('tmdb_id'),
  episodes: jsonb('episodes').$type<Record<string, AniZipEpisode>>(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
});
