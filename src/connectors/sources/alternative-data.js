import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class AlternativeDataConnector extends BaseConnector {
  constructor() {
    super({
      id: 'alternative_data',
      name: 'Alternative Data Signals',
      description: 'Aggregate alternative data — Google Trends proxy, web traffic signals, app store rankings',
      baseUrl: 'https://serpapi.com',
      domains: ['financial', 'corporate'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 2000,
    });
    this._serpApiKey = process.env.SERPAPI_KEY || '';
  }

  async search(query, options = {}) {
    try {
      const items = [];

      const trends = await this._googleTrends(query, options);
      items.push(...trends);

      const webSignals = await this._webSignals(query, options);
      items.push(...webSignals);

      const appData = await this._appStoreSignals(query, options);
      items.push(...appData);

      if (items.length === 0) {
        items.push(this._fallbackSignal(query));
      }

      return this._toEvidence(items.slice(0, options.limit || 10), options.claimId);
    } catch {
      return [];
    }
  }

  async _googleTrends(query, options) {
    if (!this._serpApiKey) return this._trendsFallback(query);

    const params = new URLSearchParams({
      engine: 'google_trends',
      q: query,
      api_key: this._serpApiKey,
    });

    const url = `${this.baseUrl}/search?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return this._trendsFallback(query);

    const interestOverTime = res.data?.interest_over_time?.timeline_data || [];
    if (interestOverTime.length === 0) return [];

    const latest = interestOverTime[interestOverTime.length - 1];
    const peak = interestOverTime.reduce((max, d) => {
      const val = d.values?.[0]?.extracted_value || 0;
      return val > (max.values?.[0]?.extracted_value || 0) ? d : max;
    }, interestOverTime[0]);

    return [{
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
      title: `${query} — Google Trends`,
      summary: `Search interest for "${query}": current ${latest?.values?.[0]?.extracted_value || 'N/A'}/100, peak ${peak?.values?.[0]?.extracted_value || 'N/A'}/100 at ${peak?.date || 'unknown'}`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: latest?.date || null,
      data: {
        currentInterest: latest?.values?.[0]?.extracted_value,
        peakInterest: peak?.values?.[0]?.extracted_value,
        peakDate: peak?.date,
        dataPoints: interestOverTime.length,
        timelineSample: interestOverTime.slice(-5).map(d => ({
          date: d.date,
          value: d.values?.[0]?.extracted_value,
        })),
      },
    }];
  }

  _trendsFallback(query) {
    return [{
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
      title: `${query} — Google Trends (manual check)`,
      summary: `Google Trends data for "${query}" — requires SERPAPI_KEY or manual lookup`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: null,
      data: {
        query,
        note: 'Set SERPAPI_KEY for automated Google Trends data',
        manualUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
      },
    }];
  }

  async _webSignals(query, options) {
    if (!this._serpApiKey) return [];

    const params = new URLSearchParams({
      engine: 'google',
      q: `"${query}" site traffic`,
      num: '3',
      api_key: this._serpApiKey,
    });

    const url = `${this.baseUrl}/search?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const results = res.data?.organic_results || [];
    return results.slice(0, 3).map(r => ({
      url: r.link || '',
      title: `${r.title || query} — Web Signal`,
      summary: (r.snippet || '').slice(0, 200),
      type: EvidenceType.CONTEXTUAL,
      timestamp: r.date || null,
      data: {
        position: r.position,
        source: r.source,
        snippet: r.snippet,
      },
    }));
  }

  async _appStoreSignals(query, options) {
    if (!this._serpApiKey) return [];

    const params = new URLSearchParams({
      engine: 'apple_app_store',
      term: query,
      num: '3',
      api_key: this._serpApiKey,
    });

    const url = `${this.baseUrl}/search?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const apps = res.data?.organic_results || [];
    return apps.slice(0, 3).map(app => ({
      url: app.link || '',
      title: `${app.title || query} — App Store`,
      summary: `${app.title}: ${app.rating || 'N/A'} stars, ${app.reviews || 'N/A'} reviews — ${app.description?.slice(0, 100) || ''}`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: null,
      data: {
        appTitle: app.title,
        rating: app.rating,
        reviews: app.reviews,
        developer: app.developer,
        price: app.price,
      },
    }));
  }

  _fallbackSignal(query) {
    return {
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
      title: `${query} — Alternative Data Summary`,
      summary: `Alternative data signals for "${query}" — limited without API keys. Check Google Trends, SimilarWeb, and App Store manually.`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: null,
      data: {
        query,
        sources: ['google_trends', 'similarweb', 'app_store'],
        note: 'Set SERPAPI_KEY for automated alternative data collection',
      },
    };
  }
}

export default AlternativeDataConnector;
