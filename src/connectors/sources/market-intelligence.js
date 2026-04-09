import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class MarketIntelligenceConnector extends BaseConnector {
  constructor() {
    super({
      id: 'market_intelligence',
      name: 'Market Intelligence',
      description: 'Aggregate financial signals — Yahoo Finance quotes/news combined with FRED macro indicators',
      baseUrl: 'https://query1.finance.yahoo.com',
      domains: ['financial'],
      trustTier: 0.70,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      // 1. Yahoo Finance search (quotes + news)
      const yahooUrl = `${this.baseUrl}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=5&enableFuzzyQuery=false`;
      const yahooRes = await this._fetch(yahooUrl);
      if (yahooRes.ok) {
        const data = yahooRes.data || {};

        for (const q of (data.quotes || [])) {
          items.push({
            url: `https://finance.yahoo.com/quote/${q.symbol}`,
            title: `${q.symbol}: ${q.shortname || q.longname || 'Unknown'}`,
            summary: [
              q.shortname || q.longname,
              q.exchDisp ? `Exchange: ${q.exchDisp}` : null,
              q.typeDisp ? `Type: ${q.typeDisp}` : null,
              q.sector ? `Sector: ${q.sector}` : null,
              q.industry ? `Industry: ${q.industry}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.NEUTRAL,
            timestamp: null,
            data: {
              source: 'yahoo_quote',
              symbol: q.symbol,
              exchange: q.exchDisp,
              type: q.typeDisp,
              sector: q.sector,
              industry: q.industry,
              score: q.score,
            },
          });
        }

        for (const n of (data.news || [])) {
          items.push({
            url: n.link || '',
            title: n.title || 'Untitled',
            summary: n.title || '',
            type: EvidenceType.CONTEXTUAL,
            timestamp: n.providerPublishTime
              ? new Date(n.providerPublishTime * 1000).toISOString()
              : null,
            data: {
              source: 'yahoo_news',
              publisher: n.publisher,
              relatedTickers: n.relatedTickers,
            },
          });
        }
      }

      // 2. FRED macro supplementary search
      const config = getConfig();
      const fredKey = config.keys?.FRED_API_KEY || config.keys?.fred_api_key || 'DEMO_KEY';
      const fredUrl = `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(query)}&api_key=${fredKey}&file_type=json&limit=5`;
      const fredRes = await this._fetch(fredUrl);
      if (fredRes.ok) {
        for (const s of (fredRes.data?.seriess || []).slice(0, 3)) {
          items.push({
            url: `https://fred.stlouisfed.org/series/${s.id}`,
            title: `FRED: ${s.id} — ${s.title || 'Untitled'}`,
            summary: `${s.title || s.id} — ${s.frequency || ''} (${s.observation_start || ''} to ${s.observation_end || ''})`,
            type: EvidenceType.CONTEXTUAL,
            timestamp: s.last_updated || null,
            data: {
              source: 'fred',
              seriesId: s.id,
              title: s.title,
              frequency: s.frequency,
              units: s.units,
              popularity: s.popularity,
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

export default MarketIntelligenceConnector;
