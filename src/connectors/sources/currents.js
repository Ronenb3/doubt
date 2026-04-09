import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Currents API Connector
 *
 * Live news aggregator with free tier (200 req/day).
 * Covers 30,000+ news sources in 200+ countries, 60+ languages.
 * Get API key at https://currentsapi.services (instant free signup)
 *
 * Complements GNews — different source weighting, broader geographic
 * coverage (especially useful for non-US/UK stories).
 *
 * Set env: CURRENTS_API_KEY=your_key
 */
class CurrentsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'currents',
      name: 'Currents API',
      description: 'Live news from 30,000+ global sources in 200+ countries — free tier 200 req/day',
      baseUrl: 'https://api.currentsapi.services/v1',
      domains: ['news', 'geopolitical'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env.CURRENTS_API_KEY;
    if (!apiKey) return [];

    try {
      const limit = Math.min(options.limit || 10, 20);
      const params = new URLSearchParams({
        keywords: query,
        apiKey,
        language: 'en',
        page_size: String(limit),
      });

      if (options.recencyMode) {
        // Restrict to last 24 hours for breaking news queries
        const start = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        params.set('start_date', start);
      }

      const res = await this._fetch(`${this.baseUrl}/search?${params}`);
      if (!res.ok) return [];

      const news = res.data?.news || [];
      const items = news.map(a => {
        const publishedAt = a.published || null;
        const ageHours = publishedAt
          ? (Date.now() - new Date(publishedAt).getTime()) / 3600000
          : null;

        return {
          url: a.url || '',
          title: a.title || query,
          summary: a.description || a.title || '',
          type: EvidenceType.SUPPORTS,
          timestamp: publishedAt,
          data: {
            author: a.author,
            category: a.category,
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

export default CurrentsConnector;
