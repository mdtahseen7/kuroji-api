import { Config } from 'src/config';
import { JikanAnimeFull } from '../types';
import { KurojiClient } from 'src/lib/http';
import { ClientModule } from 'src/helpers/client';

class JikanFetchModule extends ClientModule {
  protected override readonly client = new KurojiClient(`${Config.jikan}`);

  async fetchFull(id: string): Promise<JikanAnimeFull> {
    const { data, error } = await this.client.get<JikanAnimeFull>(`/anime/${id}/full`, {
      jsonPath: 'data'
    });

    if (error) {
      throw error;
    }

    if (!data?.mal_id) {
      throw new Error(`Anime not found`);
    }

    return data;
  }
}

const JikanFetch = new JikanFetchModule();

export { JikanFetch, JikanFetchModule };
