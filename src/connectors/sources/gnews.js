import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * GNews Connector
 *
 * Free news search API aggregating content from thousands of sources.
 * Free tier: 100 requests/day, 10 articles/request.
 * Get API key at https://gnews.io (instant, no credit card)
 *
 * Unlike RSS connectors which surface one source per feed, GNews
 * aggregates across thousands of publishers and returns keyword-ranked
 * results — better precision for specific entity/event searches.
 *
 * Set env: GNEWS_API_KEY=your_key
 */
class GNewsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'gnews',
      name: 'GNews',
      description: 'News search across thousands of sources — free tier 100 req/day, keyword-ranked',
      baseUrl: 'https://gnews.io/api/v4',
      domains: ['news', 'geopolitical'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) return [];

    try {
      const limit = Math.min(options.limit || 10, 10);  // free tier max 10
      const params = new URLSearchParams({
        q: encodeURIComponent(query).replace(/%20/g, '+'),
        apikey: apiKey,
        lang: 'en',
        max: String(limit),
        sortby: options.recencyMode ? 'publishedAt' : 'relevance',
      });

      // In recency mode, restrict to last 24 hours
      if (options.recencyMode) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        params.set('from', yesterday);
      }

      const res = await this._fetch(`${this.baseUrl}/search?${params}`);
      if (!res.ok) return [];

      const articles = res.data?.articles || [];
      const items = articles.map(a => {
        const publishedAt = a.publishedAt || null;
        const ageHours = publishedAt
          ? (Date.now() - new Date(publishedAt).getTime()) / 3600000
          : null;

        return {
          url: a.url || '',
          title: a.title || query,
          summary: a.description || a.content?.slice(0, 300) || a.title || '',
          type: EvidenceType.SUPPORTS,
          timestamp: publishedAt,
          data: {
            source: a.source?.name,
            sourceUrl: a.source?.url,
            publishedAt,
            ageHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
            image: a.image,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GNewsConnector;
