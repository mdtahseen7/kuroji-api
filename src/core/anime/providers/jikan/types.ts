// Types for Jikan v4 GET /anime/{id}/full — modeled on the official
// AnimeFullResource schema (jikan-me/jikan-rest, MIT).

export interface JikanImageSet {
  image_url: string | null;
  small_image_url: string | null;
  large_image_url: string | null;
}

export interface JikanImages {
  jpg: JikanImageSet | null;
  webp: JikanImageSet | null;
}

export interface JikanTitle {
  type: string;
  title: string;
}

export interface JikanMalUrl {
  mal_id: number | null;
  type: string | null;
  name: string | null;
  url: string | null;
}

export interface JikanAnimeFull {
  mal_id: number;
  url: string | null;
  images: JikanImages | null;
  approved: boolean | null;
  titles: JikanTitle[] | null;
  title: string | null;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[] | null;
  type: string | null;
  source: string | null;
  episodes: number | null;
  status: string | null;
  airing: boolean | null;
  duration: string | null;
  rating: string | null;
  score: number | null;
  scored_by: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  synopsis: string | null;
  background: string | null;
  season: string | null;
  year: number | null;
  producers: JikanMalUrl[] | null;
  licensors: JikanMalUrl[] | null;
  studios: JikanMalUrl[] | null;
  genres: JikanMalUrl[] | null;
  explicit_genres: JikanMalUrl[] | null;
  themes: JikanMalUrl[] | null;
  demographics: JikanMalUrl[] | null;
}
