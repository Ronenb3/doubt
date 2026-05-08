/**
 * doubt — CoinGecko Connector (Crypto Market Data)
 *
 * Live crypto-asset prices, market cap, 24h volume and 24h price change.
 * Verifies financial claims about specific coins:
 *   "BTC is over $100k" → check current_price
 *   "ETH is down 10% today" → check price_change_percentage_24h
 *
 * Public Coins API at api.coingecko.com — free, no key, generous rate limits.
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CoinGeckoConnector extends BaseConnector {
  constructor() {
    super({
      id: 'coingecko',
      name: 'CoinGecko — Crypto Market Data',
      description: 'Live crypto prices, market cap, 24h volume and price change for ~10k assets',
      baseUrl: 'https://api.coingecko.com/api/v3',
      domains: ['financial', 'general'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 15;
      const q = (query || '').trim();
      if (!q) return [];
      const normalizedQuery = this._normalizeToken(q);

      // Step 1: search for matching coins by name/symbol (small response).
      const sRes = await this._fetch(`${this.baseUrl}/search?query=${encodeURIComponent(q)}`);
      if (!sRes.ok || !sRes.data) return [];

      const rankedCoins = (sRes.data.coins || []).map(coin => {
        const exactId = this._normalizeToken(coin.id) === normalizedQuery;
        const exactName = this._normalizeToken(coin.name) === normalizedQuery;
        const exactSymbol = this._normalizeToken(coin.symbol) === normalizedQuery;
        return {
          ...coin,
          _matchRank: exactId || exactName ? 3 : exactSymbol ? 2 : 0,
        };
      });

      const highIntentMatches = rankedCoins.filter(coin => coin._matchRank === 3);
      const symbolOnlyMatches = rankedCoins.filter(coin => coin._matchRank === 2);
      const coins = (
        highIntentMatches.length > 0 ? highIntentMatches
          : symbolOnlyMatches.length > 0 ? symbolOnlyMatches
          : rankedCoins
      ).slice(0, limit);
      if (coins.length === 0) return [];

      // Step 2: pull market data for the top matches in one call.
      const ids = coins.map(c => c.id).join(',');
      const mRes = await this._fetch(
        `${this.baseUrl}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`
      );
      if (!mRes.ok || !Array.isArray(mRes.data)) return [];

      const items = mRes.data.map(m => {
        const change = m.price_change_percentage_24h;
        // A live price is contextual evidence; large moves get directional flavor.
        let type = EvidenceType.CONTEXTUAL;
        if (Number.isFinite(change)) {
          if (change >= 5) type = EvidenceType.SUPPORTS;       // strong up
          else if (change <= -5) type = EvidenceType.CONTRADICTS; // strong down
        }

        const summary = [
          'CRYPTO MARKET',
          `${m.name} (${(m.symbol || '').toUpperCase()})`,
          m.current_price != null ? `price: $${m.current_price.toLocaleString()}` : null,
          Number.isFinite(change) ? `24h: ${change.toFixed(2)}%` : null,
          m.market_cap ? `mcap: $${Math.round(m.market_cap).toLocaleString()}` : null,
        ].filter(Boolean).join(' — ');

        return {
          url: `https://www.coingecko.com/en/coins/${m.id}`,
          title: `${m.name} (${(m.symbol || '').toUpperCase()})`,
          summary,
          type,
          timestamp: m.last_updated || new Date().toISOString(),
          data: {
            id: m.id,
            symbol: m.symbol,
            name: m.name,
            price: m.current_price,
            marketCap: m.market_cap,
            volume24h: m.total_volume,
            priceChange24h: m.price_change_24h,
            priceChangePercent24h: m.price_change_percentage_24h,
            high24h: m.high_24h,
            low24h: m.low_24h,
            ath: m.ath,
            athChangePercent: m.ath_change_percentage,
            lastUpdated: m.last_updated,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _normalizeToken(value) {
    return `${value || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

export default CoinGeckoConnector;
