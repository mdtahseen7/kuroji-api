import Elysia, { t } from 'elysia';
import { db } from 'src/db';
import { mappings } from 'src/db/schema';
import { NotFoundError } from 'src/helpers/errors';
import { createSuccessResponse } from 'src/helpers/response';

const mappingsRoute = () => {
  return (app: Elysia) =>
    app.group('/mappings', { tags: ['Mappings'] }, (app) =>
      app.get(
        '/:anilistId',
        async ({ params }) => {
          const row = await db.query.mappings.findFirst({
            where: { anilist_id: params.anilistId }
          });

          if (!row) {
            throw new NotFoundError('Mappings not found');
          }

          return createSuccessResponse({
            message: 'Mappings fetched',
            data: {
              mappings: {
                anilist_id: row.anilist_id,
                mal_id: row.mal_id,
                kitsu_id: row.kitsu_id,
                anidb_id: row.anidb_id,
                tvdb_id: row.tvdb_id,
                tmdb_id: row.tmdb_id
              },
              episodes: row.episodes ?? {}
            }
          });
        },
        {
          params: t.Object({
            anilistId: t.Number()
          }),
          detail: {
            summary: 'Get Mappings',
            description: 'Returns self-hosted AniZip mappings and episode metadata for an AniList ID'
          }
        }
      )
    );
};

export { mappingsRoute };
