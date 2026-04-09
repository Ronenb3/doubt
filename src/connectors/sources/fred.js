import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class FREDConnector extends BaseConnector {
  constructor() {
    super({
      id: 'fred',
      name: 'FRED',
      description: 'Federal Reserve Economic Data — macro indicators, rates, employment, CPI',
      baseUrl: 'https://api.stlouisfed.org',
      domains: ['financial', 'economic'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
      requiresKey: false,
      keyName: 'FRED_API_KEY',
    });
  }

  _apiKey() {
    const config = getConfig();
    return config.keys?.FRED_API_KEY || 'DEMO_KEY';
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const key = this._apiKey();
      const url = `${this.baseUrl}/fred/series/search?search_text=${encodeURIComponent(query)}&api_key=${key}&file_type=json&limit=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const series = res.data?.seriess || [];
      const items = series.map(s => ({
        url: `https://fred.stlouisfed.org/series/${s.id}`,
        title: `${s.id}: ${s.title || 'Untitled'}`,
        summary: `${s.title || s.id} — ${s.frequency || ''} (${s.observation_start || ''} to ${s.observation_end || ''})`,
        type: EvidenceType.NEUTRAL,
        timestamp: s.last_updated || s.observation_end || null,
        data: {
          seriesId: s.id,
          title: s.title,
          frequency: s.frequency,
          units: s.units,
          seasonalAdjustment: s.seasonal_adjustment,
          observationStart: s.observation_start,
          observationEnd: s.observation_end,
          popularity: s.popularity,
          notes: (s.notes || '').slice(0, 300),
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default FREDConnector;
