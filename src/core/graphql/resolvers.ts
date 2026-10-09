// Resolvers serving AniList's PUBLIC GraphQL shapes from kuroji's database.
// Scope: public read surface only. Account-gated types (MediaList, User,
// Thread, etc.) and all mutations are intentionally absent from the schema.
// Fields with no kuroji data return null (never throw).
import {
  db,
  anime,
  animeTitle,
  animeStartDate,
  animeEndDate,
  animePoster,
  animeGenre,
  animeToGenre,
  animeAiringSchedule,
  animeCharacter,
  animeCharacterName,
  animeCharacterImage,
  animeToCharacter,
  characterToVoiceActor,
  animeVoiceActor,
  animeVoiceName,
  animeVoiceImage,
  animeStudio,
  animeToStudio,
  animeTag,
  animeToTag,
  animeScoreDistribution,
  animeStatusDistribution,
  animeLink,
  animeToLink,
  animeNextAiringEpisode,
} from 'src/db';
import {
  eq,
  and,
  or,
  inArray,
  gte,
  lte,
  gt,
  lt,
  sql,
  desc,
  asc,
  SQL,
  exists,
  notInArray,
  not,
  count,
  ilike,
} from 'drizzle-orm';
import { Loaders } from './loaders';
import { GraphQLError } from 'graphql';
import {
  MediaArgs,
  PageArgs,
  CharacterArgs,
  StudioArgs,
  AiringScheduleArgs,
  PageContext,
} from './types';

// ---------------------------------------------------------------- helpers

const SEASON_INDEX: Record<string, number> = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

function seasonInt(season?: string | null, year?: number | null): number | null {
  if (!season || !year || !(season in SEASON_INDEX)) return null;
  return year * 10 + (SEASON_INDEX[season] ?? 0);
}

/** AniList FuzzyDateInt is YYYYMMDD (e.g. 20240115). Returns {year, month, day}. */
function parseFuzzyDateInt(v?: number | null): { year?: number; month?: number; day?: number } {
  if (!v) return {};
  const s = String(v).padStart(8, '0');
  return {
    year: parseInt(s.slice(0, 4), 10) || undefined,
    month: parseInt(s.slice(4, 6), 10) || undefined,
    day: parseInt(s.slice(6, 8), 10) || undefined,
  };
}

function toPageInfo(total: number, page: number, perPage: number) {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  return {
    total,
    perPage,
    currentPage: page,
    lastPage,
    hasNextPage: page < lastPage,
  };
}

function emptyConnection() {
  return {
    edges: [],
    nodes: [],
    pageInfo: toPageInfo(0, 1, 25),
  };
}

// ---------------------------------------------------------------- media filter
// Adapted from the previous kuroji-native filter; args renamed to AniList's
// camelCase. Only the most-used filters are honoured; the rest are accepted
// by the schema but ignored (documented in README).

function buildMediaFilter(args: MediaArgs): {
  where: SQL | undefined;
  orderBy: SQL[];
  take: number;
  skip: number;
  page: number;
} {
  const {
    search,
    id,
    id_in,
    id_not,
    id_not_in,
    idMal,
    idMal_in,
    idMal_not,
    idMal_not_in,
    season,
    seasonYear,
    format,
    format_in,
    format_not,
    format_not_in,
    status,
    status_in,
    status_not,
    status_not_in,
    type,
    source,
    source_in,
    countryOfOrigin,
    isLicensed,
    isAdult,
    genre,
    genre_in,
    genre_not_in,
    tag,
    tag_in,
    tag_not_in,
    episodes,
    episodes_greater,
    episodes_lesser,
    duration,
    duration_greater,
    duration_lesser,
    averageScore,
    averageScore_greater,
    averageScore_lesser,
    popularity,
    popularity_greater,
    popularity_lesser,
    startDate,
    endDate,
    startDate_greater,
    startDate_lesser,
    endDate_greater,
    endDate_lesser,
    sort = ['ID_DESC'],
  } = args;

  const conditions: SQL[] = [];
  conditions.push(eq(anime.disabled, false));

  if (id !== undefined) conditions.push(eq(anime.id, id));
  if (id_in?.length) conditions.push(inArray(anime.id, id_in));
  if (id_not !== undefined) conditions.push(not(eq(anime.id, id_not)) as SQL);
  if (id_not_in?.length) conditions.push(notInArray(anime.id, id_not_in));

  if (idMal !== undefined) conditions.push(eq(anime.id_mal, idMal));
  if (idMal_in?.length) conditions.push(inArray(anime.id_mal, idMal_in));
  if (idMal_not !== undefined) conditions.push(not(eq(anime.id_mal, idMal_not)) as SQL);
  if (idMal_not_in?.length) conditions.push(notInArray(anime.id_mal, idMal_not_in));

  if (search) {
    conditions.push(
      sql`exists(select 1 from ${animeTitle} where ${animeTitle.anime_id} = ${anime.id} and ${animeTitle.search_vector} @@ plainto_tsquery('english', ${search}))`
    );
  }

  if (type) conditions.push(eq(anime.type, type));
  if (format) conditions.push(eq(anime.format, format));
  if (format_in?.length) conditions.push(inArray(anime.format, format_in));
  if (format_not) conditions.push(not(eq(anime.format, format_not)) as SQL);
  if (format_not_in?.length) conditions.push(notInArray(anime.format, format_not_in));

  if (status) conditions.push(eq(anime.status, status));
  if (status_in?.length) conditions.push(inArray(anime.status, status_in));
  if (status_not) conditions.push(not(eq(anime.status, status_not)) as SQL);
  if (status_not_in?.length) conditions.push(notInArray(anime.status, status_not_in));

  if (season) conditions.push(eq(anime.season, season));
  if (seasonYear !== undefined) conditions.push(eq(anime.season_year, seasonYear));

  if (source) conditions.push(eq(anime.source, source));
  if (source_in?.length) conditions.push(inArray(anime.source, source_in));
  if (countryOfOrigin) conditions.push(eq(anime.country, countryOfOrigin));
  if (isLicensed !== undefined) conditions.push(eq(anime.is_licensed, isLicensed));
  if (isAdult !== undefined) conditions.push(eq(anime.is_adult, isAdult));

  if (episodes !== undefined) conditions.push(eq(anime.episodes_total, episodes));
  if (episodes_greater !== undefined) conditions.push(gt(anime.episodes_total, episodes_greater));
  if (episodes_lesser !== undefined) conditions.push(lt(anime.episodes_total, episodes_lesser));
  if (duration !== undefined) conditions.push(eq(anime.duration, duration));
  if (duration_greater !== undefined) conditions.push(gt(anime.duration, duration_greater));
  if (duration_lesser !== undefined) conditions.push(lt(anime.duration, duration_lesser));

  if (averageScore !== undefined) conditions.push(eq(anime.score, averageScore));
  if (averageScore_greater !== undefined) conditions.push(gt(anime.score, averageScore_greater));
  if (averageScore_lesser !== undefined) conditions.push(lt(anime.score, averageScore_lesser));
  if (popularity !== undefined) conditions.push(eq(anime.popularity, popularity));
  if (popularity_greater !== undefined) conditions.push(gt(anime.popularity, popularity_greater));
  if (popularity_lesser !== undefined) conditions.push(lt(anime.popularity, popularity_lesser));

  const fuzzy = (table: any, v?: number, op: 'eq' | 'gt' | 'lt' = 'eq') => {
    if (v === undefined) return;
    const { year, month, day } = parseFuzzyDateInt(v);
    if (year !== undefined) {
      const col = table.year;
      conditions.push(op === 'eq' ? eq(col, year) : op === 'gt' ? gt(col, year) : lt(col, year));
    }
    if (month !== undefined) {
      const col = table.month;
      conditions.push(op === 'eq' ? eq(col, month) : op === 'gt' ? gt(col, month) : lt(col, month));
    }
    if (day !== undefined) {
      const col = table.day;
      conditions.push(op === 'eq' ? eq(col, day) : op === 'gt' ? gt(col, day) : lt(col, day));
    }
  };
  fuzzy(animeStartDate, startDate); fuzzy(animeEndDate, endDate);
  fuzzy(animeStartDate, startDate_greater, 'gt'); fuzzy(animeStartDate, startDate_lesser, 'lt');
  fuzzy(animeEndDate, endDate_greater, 'gt'); fuzzy(animeEndDate, endDate_lesser, 'lt');

  const genreExists = (names: string[], negate = false) => {
    const q = sql`exists(select 1 from ${animeToGenre} inner join ${animeGenre} on ${animeGenre.id} = ${animeToGenre}.\"B\" where ${animeToGenre}.\"A\" = ${anime.id} and ${animeGenre.name} in (${sql.join(names.map(n => sql`${n}`), sql`, `)}))`;
    conditions.push((negate ? not(q) : q) as SQL);
  };
  if (genre) genreExists([genre]);
  if (genre_in?.length) genreExists(genre_in);
  if (genre_not_in?.length) genreExists(genre_not_in, true);

  const tagExists = (names: string[], negate = false) => {
    const q = sql`exists(select 1 from ${animeToTag} inner join ${animeTag} on ${animeTag.id} = ${animeToTag}.tag_id where ${animeToTag}.anime_id = ${anime.id} and ${animeTag.name} in (${sql.join(names.map(n => sql`${n}`), sql`, `)}))`;
    conditions.push((negate ? not(q) : q) as SQL);
  };
  if (tag) tagExists([tag]);
  if (tag_in?.length) tagExists(tag_in);
  if (tag_not_in?.length) tagExists(tag_not_in, true);

  // -- sorting --
  const orderBy: SQL[] = [];
  const titleSort = (dir: 'asc' | 'desc') =>
    sql`(select ${dir === 'asc' ? 'min' : 'max'}(coalesce(${animeTitle.romaji}, ${animeTitle.english}, '')) from ${animeTitle} where ${animeTitle.anime_id} = ${anime.id}) ${dir === 'asc' ? sql`asc` : sql`desc`}`;
  for (const s of sort) {
    switch (s) {
      case 'ID': case 'ID_DESC': orderBy.push(desc(anime.id)); break;
      case 'ID_ASC': orderBy.push(asc(anime.id)); break;
      case 'TITLE_ROMAJI': orderBy.push(titleSort('asc')); break;
      case 'TITLE_ROMAJI_DESC': orderBy.push(titleSort('desc')); break;
      case 'TITLE_ENGLISH': case 'TITLE_ENGLISH_DESC':
      case 'TITLE_NATIVE': case 'TITLE_NATIVE_DESC':
        orderBy.push(s.endsWith('_DESC') || s === 'TITLE_ENGLISH_DESC' || s === 'TITLE_NATIVE_DESC' ? titleSort('desc') : titleSort('asc')); break;
      case 'SCORE': case 'SCORE_DESC': orderBy.push(desc(anime.score)); break;
      case 'SCORE_ASC': orderBy.push(asc(anime.score)); break;
      case 'POPULARITY': case 'POPULARITY_DESC': orderBy.push(desc(anime.popularity)); break;
      case 'POPULARITY_ASC': orderBy.push(asc(anime.popularity)); break;
      case 'TRENDING': case 'TRENDING_DESC': orderBy.push(desc(anime.trending)); break;
      case 'TRENDING_ASC': orderBy.push(asc(anime.trending)); break;
      case 'FAVOURITES': case 'FAVOURITES_DESC': orderBy.push(desc(anime.favorites)); break;
      case 'FAVOURITES_ASC': orderBy.push(asc(anime.favorites)); break;
      case 'UPDATED_AT': case 'UPDATED_AT_DESC': orderBy.push(desc(anime.updated_at)); break;
      case 'UPDATED_AT_ASC': orderBy.push(asc(anime.updated_at)); break;
      case 'START_DATE': case 'START_DATE_DESC':
        orderBy.push(sql`(select ${animeStartDate.year} * 10000 + ${animeStartDate.month} * 100 + ${animeStartDate.day} from ${animeStartDate} where ${animeStartDate.anime_id} = ${anime.id}) desc`); break;
      case 'START_DATE_ASC':
        orderBy.push(sql`(select ${animeStartDate.year} * 10000 + ${animeStartDate.month} * 100 + ${animeStartDate.day} from ${animeStartDate} where ${animeStartDate.anime_id} = ${anime.id}) asc`); break;
      case 'EPISODES': case 'EPISODES_DESC': orderBy.push(desc(anime.episodes_total)); break;
      case 'EPISODES_ASC': orderBy.push(asc(anime.episodes_total)); break;
      case 'DURATION': case 'DURATION_DESC': orderBy.push(desc(anime.duration)); break;
      case 'DURATION_ASC': orderBy.push(asc(anime.duration)); break;
      default: break;
    }
  }
  if (!orderBy.length) orderBy.push(desc(anime.id));

  return { where: conditions.length ? and(...conditions) : undefined, orderBy, take: 0, skip: 0, page: 1 };
}

async function queryMedia(args: MediaArgs, page: number, perPage: number) {
  if (perPage > 50) {
    throw new GraphQLError('perPage exceeds the limit of 50', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  const { where, orderBy } = buildMediaFilter(args);
  const skip = (page - 1) * perPage;

  const [rows, totalRes] = await Promise.all([
    db.select().from(anime).where(where).orderBy(...orderBy).limit(perPage).offset(skip),
    db.select({ c: count() }).from(anime).where(where),
  ]);
  const total = totalRes[0]?.c ?? 0;
  return { rows, pageInfo: toPageInfo(total, page, perPage) };
}

// ---------------------------------------------------------------- Query

async function resolveSingleMedia(args: MediaArgs) {
  const { rows } = await queryMedia(args, 1, 1);
  return rows[0] ?? null;
}

export const Query = {
  Page: (_: unknown, args: PageArgs): PageContext => ({
    page: args.page ?? 1,
    perPage: Math.min(args.perPage ?? 25, 50),
  }),

  Media: (_: unknown, args: MediaArgs) => resolveSingleMedia(args),

  MediaTrend: () => null,

  AiringSchedule: async (_: unknown, args: AiringScheduleArgs) => {
    const conditions: SQL[] = [];
    if (args.id !== undefined) {
      // ids are synthetic hashes; look up directly is unreliable -> scan by episode/media
      return null;
    }
    if (args.mediaId !== undefined) conditions.push(eq(animeAiringSchedule.anime_id, args.mediaId));
    if (args.episode !== undefined) conditions.push(eq(animeAiringSchedule.episode, args.episode));
    if (args.airingAt !== undefined) conditions.push(eq(animeAiringSchedule.airing_at, args.airingAt));
    if (args.airingAt_greater !== undefined)
      conditions.push(gt(animeAiringSchedule.airing_at, args.airingAt_greater));
    if (args.airingAt_lesser !== undefined)
      conditions.push(lt(animeAiringSchedule.airing_at, args.airingAt_lesser));
    if (!conditions.length) return null;
    const rows = await db
      .select()
      .from(animeAiringSchedule)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ?? null;
  },

  Character: async (_: unknown, args: CharacterArgs) => {
    if (args.id !== undefined) {
      const rows = await db.select().from(animeCharacter).where(eq(animeCharacter.id, args.id)).limit(1);
      return rows[0] ?? null;
    }
    if (args.search) {
      const rows = await db
        .select({ c: animeCharacter })
        .from(animeCharacter)
        .innerJoin(animeCharacterName, eq(animeCharacterName.character_id, animeCharacter.id))
        .where(
          or(
            ilike(animeCharacterName.full, `%${args.search}%`),
            ilike(animeCharacterName.native, `%${args.search}%`)
          )
        )
        .limit(1);
      return rows[0]?.c ?? null;
    }
    return null;
  },

  Staff: () => null,

  Studio: async (_: unknown, args: StudioArgs) => {
    if (args.id !== undefined) {
      const rows = await db.select().from(animeStudio).where(eq(animeStudio.id, args.id)).limit(1);
      return rows[0] ?? null;
    }
    if (args.search) {
      const rows = await db
        .select()
        .from(animeStudio)
        .where(ilike(animeStudio.name, `%${args.search}%`))
        .limit(1);
      return rows[0] ?? null;
    }
    return null;
  },

  Review: () => null,

  GenreCollection: async () => {
    const rows = await db.select({ name: animeGenre.name }).from(animeGenre).orderBy(asc(animeGenre.name));
    return rows.map((r) => r.name);
  },

  MediaTagCollection: async () => {
    const rows = await db.select().from(animeTag).orderBy(asc(animeTag.name));
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      rank: null,
      isGeneralSpoiler: null,
      isMediaSpoiler: null,
      isAdult: t.is_adult,
      userId: null,
    }));
  },

  ExternalLinkSourceCollection: async () => {
    const rows = await db.selectDistinct({ label: animeLink.label }).from(animeLink);
    return rows.map((r) => r.label).filter(Boolean);
  },

  Markdown: (_: unknown, args: { markdown?: string }) => {
    const md = args.markdown ?? '';
    // minimal markdown -> html (paragraphs + line breaks); not a full renderer
    const html = md
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    return { html };
  },

  SiteStatistics: async () => ({
    users: emptyConnection(),
    anime: emptyConnection(),
    manga: emptyConnection(),
    characters: emptyConnection(),
    staff: emptyConnection(),
    studios: emptyConnection(),
    reviews: emptyConnection(),
  }),
};

// ---------------------------------------------------------------- Page

export const Page = {
  pageInfo: (parent: PageContext) => toPageInfo(0, parent.page, parent.perPage),

  media: async (parent: PageContext, args: MediaArgs) => {
    const { rows } = await queryMedia(args, parent.page, parent.perPage);
    return rows;
  },

  characters: async (parent: PageContext, args: CharacterArgs) => {
    const perPage = parent.perPage;
    const skip = (parent.page - 1) * perPage;
    const conditions: SQL[] = [];
    if (args.id !== undefined) conditions.push(eq(animeCharacter.id, args.id));
    if (args.id_in?.length) conditions.push(inArray(animeCharacter.id, args.id_in));
    if (args.search) {
      conditions.push(
        sql`exists(select 1 from ${animeCharacterName} where ${animeCharacterName}.character_id = ${animeCharacter.id} and (${animeCharacterName}.full ilike ${'%' + args.search + '%'} or ${animeCharacterName}.native ilike ${'%' + args.search + '%'}))`
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(animeCharacter).where(where).orderBy(asc(animeCharacter.id)).limit(perPage).offset(skip);
    return rows;
  },

  staff: () => [],

  studios: async (parent: PageContext, args: StudioArgs) => {
    const perPage = parent.perPage;
    const skip = (parent.page - 1) * perPage;
    const conditions: SQL[] = [];
    if (args.id !== undefined) conditions.push(eq(animeStudio.id, args.id));
    if (args.id_in?.length) conditions.push(inArray(animeStudio.id, args.id_in));
    if (args.search) conditions.push(ilike(animeStudio.name, `%${args.search}%`));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(animeStudio).where(where).orderBy(asc(animeStudio.name)).limit(perPage).offset(skip);
    return rows;
  },

  airingSchedules: async (parent: PageContext, args: AiringScheduleArgs) => {
    const perPage = parent.perPage;
    const skip = (parent.page - 1) * perPage;
    const conditions: SQL[] = [];
    if (args.mediaId !== undefined) conditions.push(eq(animeAiringSchedule.anime_id, args.mediaId));
    if (args.episode !== undefined) conditions.push(eq(animeAiringSchedule.episode, args.episode));
    if (args.airingAt_greater !== undefined)
      conditions.push(gt(animeAiringSchedule.airing_at, args.airingAt_greater));
    if (args.airingAt_lesser !== undefined)
      conditions.push(lt(animeAiringSchedule.airing_at, args.airingAt_lesser));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(animeAiringSchedule).where(where).orderBy(asc(animeAiringSchedule.airing_at)).limit(perPage).offset(skip);
    return rows.map((r) => toAiringSchedule(r, r.anime_id));
  },

  mediaTrends: () => [],
  reviews: () => [],
};

// ---------------------------------------------------------------- Media

type AnimeRow = typeof anime.$inferSelect;

async function toCharacterConnection(
  animeId: number,
  ctx: { loaders: Loaders }
) {
  const conns = await ctx.loaders.characterConnections.load(animeId);
  const edges = await Promise.all(
    conns.map(async (conn) => {
      const [character, vas] = await Promise.all([
        ctx.loaders.character.load(conn.character_id),
        ctx.loaders.voiceActors.load(conn.id),
      ]);
      if (!character) return null;
      const voiceActors = await Promise.all(
        vas.map(async (va) => {
          const name = await ctx.loaders.voiceName.load(va.id);
          const image = await ctx.loaders.voiceImage.load(va.id);
          return { ...va, name, image };
        })
      );
      const name = await ctx.loaders.characterName.load(character.id);
      const image = await ctx.loaders.characterImage.load(character.id);
      return {
        node: { ...character, name, image },
        role: conn.role ?? null,
        voiceActors,
      };
    })
  );
  const valid = edges.filter(Boolean);
  return {
    edges: valid,
    nodes: valid.map((e: any) => e.node),
    pageInfo: toPageInfo(valid.length, 1, Math.max(valid.length, 1)),
  };
}

async function toStudioConnection(animeId: number, ctx: { loaders: Loaders }) {
  const conns = await ctx.loaders.studioConnections.load(animeId);
  const edges = await Promise.all(
    conns.map(async (conn) => {
      const studio = await ctx.loaders.studio.load(conn.studio_id);
      if (!studio) return null;
      return { node: studio, isMain: conn.is_main ?? null };
    })
  );
  const valid = edges.filter(Boolean);
  return {
    edges: valid,
    nodes: valid.map((e: any) => e.node),
    pageInfo: toPageInfo(valid.length, 1, Math.max(valid.length, 1)),
  };
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const Media = {
  id: (p: AnimeRow) => p.id,
  idMal: (p: AnimeRow) => p.id_mal ?? null,
  title: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const t = await ctx.loaders.title.load(p.id);
    if (!t) return null;
    return { romaji: t.romaji ?? null, english: t.english ?? null, native: t.native ?? null, userPreferred: null };
  },
  type: (p: AnimeRow) => p.type ?? null,
  format: (p: AnimeRow) => p.format ?? null,
  status: (p: AnimeRow) => p.status ?? null,
  description: (p: AnimeRow) => p.description ?? null,
  startDate: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const d = await ctx.loaders.startDate.load(p.id);
    if (!d) return null;
    return { year: d.year ?? null, month: d.month ?? null, day: d.day ?? null };
  },
  endDate: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const d = await ctx.loaders.endDate.load(p.id);
    if (!d) return null;
    return { year: d.year ?? null, month: d.month ?? null, day: d.day ?? null };
  },
  season: (p: AnimeRow) => p.season ?? null,
  seasonYear: (p: AnimeRow) => p.season_year ?? null,
  seasonInt: (p: AnimeRow) => seasonInt(p.season, p.season_year),
  episodes: (p: AnimeRow) => p.episodes_total ?? null,
  duration: (p: AnimeRow) => p.duration ?? null,
  chapters: () => null,
  volumes: () => null,
  countryOfOrigin: (p: AnimeRow) => p.country ?? null,
  isLicensed: (p: AnimeRow) => p.is_licensed ?? false,
  source: (p: AnimeRow) => p.source ?? null,
  hashtag: (p: AnimeRow) => p.hashtag ?? null,
  trailer: () => null,
  updatedAt: (p: AnimeRow) => p.updated_at ?? null,
  coverImage: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const poster = await ctx.loaders.poster.load(p.id);
    return {
      extraLarge: poster?.large ?? null,
      large: poster?.large ?? null,
      medium: poster?.medium ?? null,
      color: p.color ?? null,
    };
  },
  bannerImage: () => null,
  genres: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const gs = await ctx.loaders.genres.load(p.id);
    return gs.map((g) => g.name);
  },
  synonyms: () => [],
  averageScore: (p: AnimeRow) => p.score ?? null,
  meanScore: (p: AnimeRow) => p.score ?? null,
  popularity: (p: AnimeRow) => p.popularity ?? null,
  isLocked: () => false,
  trending: (p: AnimeRow) => p.trending ?? null,
  favourites: (p: AnimeRow) => p.favorites ?? null,
  isFavourite: () => false,
  isFavouriteBlocked: () => false,
  isAdult: (p: AnimeRow) => p.is_adult ?? false,
  tags: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const conns = await ctx.loaders.tagConnections.load(p.id);
    const tags = await Promise.all(conns.map((c) => ctx.loaders.tag.load(c.tag_id)));
    return conns
      .map((conn, i) => {
        const t = tags[i];
        if (!t) return null;
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          rank: conn.rank ?? null,
          isGeneralSpoiler: null,
          isMediaSpoiler: conn.is_spoiler ?? null,
          isAdult: t.is_adult ?? null,
          userId: null,
        };
      })
      .filter(Boolean);
  },
  relations: () => emptyConnection(),
  characters: (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => toCharacterConnection(p.id, ctx),
  staff: () => [],
  studios: (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => toStudioConnection(p.id, ctx),
  isRecommendationBlocked: () => false,
  isReviewBlocked: () => false,
  nextAiringEpisode: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const s = await ctx.loaders.nextAiringEpisode.load(p.id);
    if (!s) return null;
    return toAiringSchedule(s, p.id);
  },
  airingSchedule: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const rows = await ctx.loaders.airingSchedule.load(p.id);
    const nodes = rows.map((r) => toAiringSchedule(r, p.id));
    return { edges: nodes.map((n) => ({ node: n })), nodes, pageInfo: toPageInfo(nodes.length, 1, Math.max(nodes.length, 1)) };
  },
  trends: () => emptyConnection(),
  externalLinks: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const links = await ctx.loaders.links.load(p.id);
    return links.map((l, i) => ({
      id: hashId(l.id || `${p.id}-${i}`),
      url: l.link,
      site: l.label ?? null,
      siteId: null,
      type: ['INFO', 'STREAMING', 'SOCIAL'].includes((l.type || '').toUpperCase())
        ? (l.type as string).toUpperCase()
        : null,
      language: null,
      color: null,
      icon: null,
      notes: null,
      isDisabled: null,
    }));
  },
  streamingEpisodes: () => [],
  rankings: () => [],
  reviews: () => emptyConnection(),
  stats: async (p: AnimeRow, _: unknown, ctx: { loaders: Loaders }) => {
    const [score, status] = await Promise.all([
      ctx.loaders.scoreDistribution.load(p.id),
      ctx.loaders.statusDistribution.load(p.id),
    ]);
    return {
      scoreDistribution: score.map((s) => ({ score: s.score, amount: s.amount })),
      statusDistribution: status.map((s) => ({ status: s.status, amount: s.amount })),
      airingProgression: null,
    };
  },
  siteUrl: (p: AnimeRow) => `https://anilist.co/anime/${p.id}`,
  autoCreateForumThread: () => null,
  modNotes: () => null,
};

function toAiringSchedule(row: typeof animeAiringSchedule.$inferSelect, mediaId: number) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: hashId(row.id || `${mediaId}-${row.episode}`),
    airingAt: row.airing_at ?? null,
    timeUntilAiring: row.airing_at ? Math.max(0, row.airing_at - now) : null,
    episode: row.episode ?? null,
    mediaId,
    _mediaId: mediaId,
  };
}

// ---------------------------------------------------------------- Character

type CharacterRow = typeof animeCharacter.$inferSelect;

export const Character = {
  id: (p: CharacterRow) => p.id,
  name: async (p: CharacterRow, _: unknown, ctx: { loaders: Loaders }) => {
    const n = await ctx.loaders.characterName.load(p.id);
    if (!n) return null;
    return {
      first: n.first ?? null,
      middle: n.middle ?? null,
      last: n.last ?? null,
      full: n.full ?? null,
      native: n.native ?? null,
      alternative: n.alternative ?? [],
      alternativeSpoiler: n.alternative_spoiler ?? [],
      userPreferred: null,
    };
  },
  image: async (p: CharacterRow, _: unknown, ctx: { loaders: Loaders }) => {
    const i = await ctx.loaders.characterImage.load(p.id);
    if (!i) return null;
    return { large: i.large ?? null, medium: i.medium ?? null };
  },
  description: (p: CharacterRow) => p.description ?? null,
  gender: (p: CharacterRow) => p.gender ?? null,
  dateOfBirth: async (p: CharacterRow, _: unknown, ctx: { loaders: Loaders }) => {
    const d = await ctx.loaders.characterBirthDate.load(p.id);
    if (!d) return null;
    return { year: d.year ?? null, month: d.month ?? null, day: d.day ?? null };
  },
  age: (p: CharacterRow) => p.age ?? null,
  bloodType: (p: CharacterRow) => p.blood_type ?? null,
  isFavourite: () => false,
  isFavouriteBlocked: () => false,
  siteUrl: (p: CharacterRow) => `https://anilist.co/character/${p.id}`,
  media: async (p: CharacterRow) => {
    // reverse lookup: media this character appears in
    const rows = await db
      .select({ m: anime })
      .from(animeToCharacter)
      .innerJoin(anime, eq(anime.id, animeToCharacter.anime_id))
      .where(eq(animeToCharacter.character_id, p.id))
      .limit(25);
    const nodes = rows.map((r) => r.m);
    return { edges: nodes.map((n) => ({ node: n })), nodes, pageInfo: toPageInfo(nodes.length, 1, Math.max(nodes.length, 1)) };
  },
  updatedAt: () => null,
  favourites: () => null,
  modNotes: () => null,
};

// ---------------------------------------------------------------- Studio

type StudioRow = typeof animeStudio.$inferSelect;

export const Studio = {
  id: (p: StudioRow) => p.id,
  name: (p: StudioRow) => p.name ?? null,
  isAnimationStudio: () => null,
  siteUrl: (p: StudioRow) => `https://anilist.co/studio/${p.id}`,
  isFavourite: () => false,
  favourites: () => null,
  media: async (p: StudioRow) => {
    const rows = await db
      .select({ m: anime })
      .from(animeToStudio)
      .innerJoin(anime, eq(anime.id, animeToStudio.anime_id))
      .where(eq(animeToStudio.studio_id, p.id))
      .orderBy(desc(anime.popularity))
      .limit(25);
    const nodes = rows.map((r) => r.m);
    return { edges: nodes.map((n) => ({ node: n })), nodes, pageInfo: toPageInfo(nodes.length, 1, Math.max(nodes.length, 1)) };
  },
};

// ---------------------------------------------------------------- AiringSchedule

export const AiringSchedule = {
  id: (p: { id: number }) => p.id,
  airingAt: (p: { airingAt: number | null }) => p.airingAt,
  timeUntilAiring: (p: { timeUntilAiring: number | null }) => p.timeUntilAiring,
  episode: (p: { episode: number | null }) => p.episode,
  mediaId: (p: { mediaId: number }) => p.mediaId,
  media: async (p: { _mediaId: number }) => {
    const rows = await db.select().from(anime).where(eq(anime.id, p._mediaId)).limit(1);
    return rows[0] ?? null;
  },
};

// ---------------------------------------------------------------- export

export const resolvers = {
  Query,
  Page,
  Media,
  Character,
  Studio,
  AiringSchedule,
};
