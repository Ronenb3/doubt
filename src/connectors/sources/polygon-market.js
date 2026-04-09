import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class PolygonMarketConnector extends BaseConnector {
  constructor() {
    super({
      id: 'polygon_market',
      name: 'Polygon.io',
      description: 'Stock market data — ticker search, previous close, and reference data',
      baseUrl: 'https://api.polygon.io',
      domains: ['financial'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 1200,
      requiresKey: false,
      keyName: 'POLYGON_API_KEY',
    });
  }

  _apiKey() {
    const config = getConfig();
    return config.keys?.POLYGON_API_KEY || config.keys?.polygon_api_key || '';
  }

  async search(query, options = {}) {
    try {
      const key = this._apiKey();
      const items = [];

      // Ticker reference search
      if (key) {
        const limit = options.limit || 10;
        const url = `${this.baseUrl}/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&limit=${limit}&apiKey=${key}`;
        const res = await this._fetch(url);
        if (res.ok) {
          for (const t of (res.data?.results || [])) {
            items.push({
              url: `https://polygon.io/quote/${t.ticker}`,
              title: `${t.ticker}: ${t.name || 'Unknown'}`,
              summary: [
                t.name,
                t.market ? `Market: ${t.market}` : null,
                t.primary_exchange ? `Exchange: ${t.primary_exchange}` : null,
                t.type ? `Type: ${t.type}` : null,
              ].filter(Boolean).join(' — '),
              type: EvidenceType.NEUTRAL,
              timestamp: t.last_updated_utc || null,
              data: {
                ticker: t.ticker,
                name: t.name,
                market: t.market,
                locale: t.locale,
                primaryExchange: t.primary_exchange,
                type: t.type,
                currencyName: t.currency_name,
                cik: t.cik,
                compositeFigi: t.composite_figi,
              },
            });
          }
        }
      }

      // Previous-day aggregate (works with a ticker symbol directly)
      const ticker = query.toUpperCase().replace(/[^A-Z]/g, '');
      if (ticker.length >= 1 && ticker.length <= 5) {
        const aggKey = key || '';
        const aggUrl = `${this.baseUrl}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${aggKey}`;
        const aggRes = await this._fetch(aggUrl);
        if (aggRes.ok && aggRes.data?.results?.length) {
          const r = aggRes.data.results[0];
          items.push({
            url: `https://polygon.io/quote/${ticker}`,
            title: `${ticker} Previous Close: $${r.c}`,
            summary: `${ticker} — Open: $${r.o}, High: $${r.h}, Low: $${r.l}, Close: $${r.c}, Volume: ${r.v}`,
            type: EvidenceType.NEUTRAL,
            timestamp: r.t ? new Date(r.t).toISOString() : null,
            data: {
              ticker,
              open: r.o,
              high: r.h,
              low: r.l,
              close: r.c,
              volume: r.v,
              vwap: r.vw,
              transactions: r.n,
            },
          });
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PolygonMarketConnector;
