import { Config } from 'src/config';
import { AniZipResponse } from '../types';
import { KurojiClient } from 'src/lib/http';
import { ClientModule } from 'src/helpers/client';

class AnizipFetchModule extends ClientModule {
  protected override readonly client = new KurojiClient(Config.anizip);

  async fetchMappings(anilistId: number): Promise<AniZipResponse> {
    const { data, error } = await this.client.get<AniZipResponse>(`mappings?anilist_id=${anilistId}`);

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('No data found');
    }

    return data;
  }
}

const AnizipFetch = new AnizipFetchModule();

export { AnizipFetch, AnizipFetchModule };
