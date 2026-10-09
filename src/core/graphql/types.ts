// Argument interfaces mirroring AniList's public GraphQL API (camelCase).
// Only the public read surface is modelled; account-gated args are omitted.

export interface PageArgs {
  page?: number;
  perPage?: number;
}

export interface MediaArgs {
  id?: number;
  idMal?: number;
  startDate?: number;
  endDate?: number;
  season?: string;
  seasonYear?: number;
  type?: string;
  format?: string;
  status?: string;
  episodes?: number;
  duration?: number;
  chapters?: number;
  volumes?: number;
  isAdult?: boolean;
  genre?: string;
  tag?: string;
  minimumTagRank?: number;
  tagCategory?: string;
  onList?: boolean;
  licensedBy?: string;
  licensedById?: number;
  averageScore?: number;
  popularity?: number;
  source?: string;
  countryOfOrigin?: string;
  isLicensed?: boolean;
  search?: string;
  id_not?: number;
  id_in?: number[];
  id_not_in?: number[];
  idMal_not?: number;
  idMal_in?: number[];
  idMal_not_in?: number[];
  startDate_greater?: number;
  startDate_lesser?: number;
  startDate_like?: string;
  endDate_greater?: number;
  endDate_lesser?: number;
  endDate_like?: string;
  format_in?: string[];
  format_not?: string;
  format_not_in?: string[];
  status_in?: string[];
  status_not?: string;
  status_not_in?: string[];
  episodes_greater?: number;
  episodes_lesser?: number;
  duration_greater?: number;
  duration_lesser?: number;
  chapters_greater?: number;
  chapters_lesser?: number;
  volumes_greater?: number;
  volumes_lesser?: number;
  genre_in?: string[];
  genre_not_in?: string[];
  tag_in?: string[];
  tag_not_in?: string[];
  tagCategory_in?: string[];
  tagCategory_not_in?: string[];
  licensedBy_in?: string[];
  licensedById_in?: number[];
  averageScore_not?: number;
  averageScore_greater?: number;
  averageScore_lesser?: number;
  popularity_not?: number;
  popularity_greater?: number;
  popularity_lesser?: number;
  source_in?: string[];
  countryOfOrigin_in?: string[];
  countryOfOrigin_not_in?: string[];
  sort?: string[];
}

export interface CharacterArgs {
  id?: number;
  search?: string;
  id_in?: number[];
}

export interface StaffArgs {
  id?: number;
  search?: string;
  id_in?: number[];
}

export interface StudioArgs {
  id?: number;
  search?: string;
  id_in?: number[];
}

export interface AiringScheduleArgs {
  id?: number;
  mediaId?: number;
  episode?: number;
  airingAt?: number;
  airingAt_greater?: number;
  airingAt_lesser?: number;
}

export interface MediaTrendArgs {
  mediaId?: number;
  date?: number;
  trending?: number;
  averageScore?: number;
  popularity?: number;
  episode?: number;
  releasing?: boolean;
  sort?: string[];
}

export interface ReviewArgs {
  id?: number;
  mediaId?: number;
  userId?: number;
  mediaType?: string;
  sort?: string[];
}

export interface MarkdownArgs {
  markdown?: string;
}

// Pagination context passed from Query.Page to Page.* field resolvers
export interface PageContext {
  page: number;
  perPage: number;
}
