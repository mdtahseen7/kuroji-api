// Types grounded on the real api.ani.zip response shape
// (verified against https://api.ani.zip/mappings?anilist_id=21)

export interface AniZipEpisode {
  tvdbShowId?: number;
  tvdbId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
  title?: Record<string, string>;
  airDate?: string;
  airDateUtc?: string;
  runtime?: number;
  overview?: string;
  image?: string;
  episode?: string;
  anidbEid?: number;
  length?: number;
  airdate?: string;
  rating?: string;
  summary?: string;
}

export interface AniZipMappings {
  animeplanet_id?: string;
  kitsu_id?: number;
  mal_id?: number;
  type?: string;
  anilist_id?: number;
  anisearch_id?: number;
  anidb_id?: number;
  notifymoe_id?: number | null;
  livechart_id?: number;
  thetvdb_id?: number;
  imdb_id?: string;
  themoviedb_id?: string;
}

export interface AniZipImage {
  coverType?: string;
  url?: string;
}

export interface AniZipResponse {
  titles?: Record<string, string>;
  episodes?: Record<string, AniZipEpisode>;
  episodeCount?: number;
  specialCount?: number;
  images?: AniZipImage[];
  mappings?: AniZipMappings;
}
