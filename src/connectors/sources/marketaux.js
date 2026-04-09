/**
 * Marketaux Connector
 *
 * Real-time financial news with entity/ticker tagging and sentiment scores.
 * Every article comes with: matched tickers, sentiment polarity (-1 → +1),
 * and entity highlights. Ideal for financial investigations — surfaces
 * market-moving news tied to specific companies or people.
 *
 * Free tier: 100 requests/day
 * Sign up: https://www.marketaux.com/register
 * Key name: MARKETAUX_API_KEY
 * Trust: NEWS_MAJOR (0.65)
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class MarketauxConnector extends BaseConnector {
  constructor() {
    super({
      id: 'marketaux',
      name: 'Marketaux',
      description: 'Financial news with ticker tags, entity extraction, and sentiment scores',
      baseUrl: 'https://api.marketaux.com/v1',
      domains: ['financial', 'news', 'corporate'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1200,
      requiresKey: true,
      keyName: 'MARKETAUX_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['MARKETAUX_API_KEY'];
      if (!apiKey) return [];

      // Detect if query looks like a ticker (1-5 uppercase letters)
      const tickerMatch = query.match(/^[A-Z]{1,5}$/);

      const params = new URLSearchParams({
        api_token: apiKey,
        limit: String(options.limit || 20),
        language: 'en',
        sort: 'entity_match_score',
      });

      if (tickerMatch) {
        params.set('symbols', query);
      } else {
        params.set('search', query);
      }

      if (options.dateRange?.start) params.set('published_after', options.dateRange.start + 'T00:00:00');
      if (options.dateRange?.end)   params.set('published_before', options.dateRange.end + 'T23:59:59');

      const res = await this._fetch(`${this.baseUrl}/news/all?${params}`);
      if (!res.ok) return [];

      const articles = res.data?.data || [];
      const items = articles.map(a => {
        // Aggregate entity-level sentiment into a single signal
        const sentiments = (a.entities || []).map(e => e.sentiment_score).filter(Number.isFinite);
        const avgSentiment = sentiments.length
          ? sentiments.reduce((s, v) => s + v, 0) / sentiments.length
          : null;

        const tickers = (a.entities || []).map(e => e.symbol).filter(Boolean).join(', ');
        const highlights = (a.entities || []).map(e => e.name).filter(Boolean).join(', ');

        let evidenceType = EvidenceType.NEUTRAL;
        if (avgSentiment !== null) {
          if (avgSentiment > 0.15)       evidenceType = EvidenceType.SUPPORTING;
          else if (avgSentiment < -0.15) evidenceType = EvidenceType.CONTRADICTING;
        }

        return {
          url: a.url,
          title: a.title,
          summary: a.description
            ? `${a.description.slice(0, 300)}${tickers ? ` [${tickers}]` : ''}`
            : a.title,
          type: evidenceType,
          timestamp: a.published_at || null,
          data: {
            source: a.source,
            sentiment: avgSentiment,
            tickers: (a.entities || []).map(e => e.symbol).filter(Boolean),
            entities: highlights,
            snippet: a.snippet,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default MarketauxConnector;
