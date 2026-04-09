import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class HackerNewsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'hackernews',
      name: 'Hacker News',
      description: 'Hacker News via Algolia — tech community discussions and shared articles',
      baseUrl: 'https://hn.algolia.com',
      domains: ['tech', 'social'],
      trustTier: SourceTrust.SOCIAL_MEDIA,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const hitsPerPage = options.limit || 15;
      const url = `${this.baseUrl}/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${hitsPerPage}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits || [];
      const items = hits.map(h => ({
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title || 'Untitled',
        summary: h.title || '',
        type: EvidenceType.CONTEXTUAL,
        timestamp: h.created_at || null,
        data: {
          hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
          points: h.points,
          comments: h.num_comments,
          author: h.author,
          objectID: h.objectID,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default HackerNewsConnector;
