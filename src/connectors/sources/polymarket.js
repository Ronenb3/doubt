/**
 * doubt — Polymarket Connector (Prediction Markets)
 *
 * Live prediction-market prices = aggregated crowd belief.
 * For a claim "X will happen by Y," the market price is direct evidence of
 * what people willing to bet money think the probability is.
 * Free public Gamma API at gamma-api.polymarket.com.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PolymarketConnector extends BaseConnector {
  constructor() {
    super({
      id: 'polymarket',
      name: 'Polymarket — Prediction Markets',
      description: 'Live prediction-market prices reflecting crowd-aggregated probability estimates',
      baseUrl: 'https://gamma-api.polymarket.com',
      domains: ['general', 'financial', 'geopolitical'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 800,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 15;
      const params = new URLSearchParams({
        active: 'true',
        closed: 'false',
        limit: String(limit),
        order: 'volume',
        ascending: 'false',
      });
      // Only add a query if there is one — empty queries return top by volume
      if (query) params.set('search', query);

      const url = `${this.baseUrl}/markets?${params.toString()}`;
      const res = await this._fetch(url);
      if (!res.ok || !Array.isArray(res.data)) return [];

      const items = res.data.slice(0, limit).map(m => {
        const yesPrice = parseFloat(m.outcomePrices ? JSON.parse(m.outcomePrices)[0] : NaN);
        const probPercent = Number.isFinite(yesPrice) ? Math.round(yesPrice * 100) : null;
        const marketUrl = m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com';

        // High-confidence YES markets support the claim; high-confidence NO contradicts it.
        // Only call it directional if probability is clearly off 50/50.
        let type = EvidenceType.NEUTRAL;
        if (Number.isFinite(yesPrice)) {
          if (yesPrice >= 0.65) type = EvidenceType.SUPPORTS;
          else if (yesPrice <= 0.35) type = EvidenceType.CONTRADICTS;
          else type = EvidenceType.CONTEXTUAL;
        }

        const summary = [
          'PREDICTION MARKET',
          m.question || m.title,
          probPercent !== null ? `crowd probability: ${probPercent}%` : null,
          m.volume ? `volume: $${Math.round(parseFloat(m.volume) || 0).toLocaleString()}` : null,
          m.endDate ? `resolves ${m.endDate.slice(0, 10)}` : null,
        ].filter(Boolean).join(' — ');

        return {
          url: marketUrl,
          title: m.question || m.title,
          summary,
          type,
          timestamp: m.startDate || m.createdAt || null,
          data: {
            marketId: m.id,
            slug: m.slug,
            question: m.question,
            yesPrice,
            probPercent,
            volume: parseFloat(m.volume || 0),
            liquidity: parseFloat(m.liquidity || 0),
            endDate: m.endDate,
            category: m.category,
            tags: m.tags,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PolymarketConnector;
