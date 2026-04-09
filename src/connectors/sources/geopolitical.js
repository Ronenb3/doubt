import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GeopoliticalConnector extends BaseConnector {
  constructor() {
    super({
      id: 'geopolitical',
      name: 'GDELT Geopolitical',
      description: 'GDELT GKG sentiment and tone analysis — geopolitical event tracking over time',
      baseUrl: 'https://api.gdeltproject.org',
      domains: ['geopolitical', 'news'],
      trustTier: 0.70,
      rateMs: 6000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = await this._tonechart(query, options);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      const docItems = await this._docSearch(query, options);
      return this._toEvidence(docItems, options.claimId);
    } catch {
      return [];
    }
  }

  async _tonechart(query, options) {
    const url = `${this.baseUrl}/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=tonechart&format=json&timespan=3months&sourcelang=eng`;
    const res = await this._fetch(url, { timeout: 30000 });
    if (!res.ok || !Array.isArray(res.data)) return [];

    return res.data.slice(0, options.limit || 10).map(entry => ({
      url: entry.url || '',
      title: entry.title || `GDELT tone data: ${query}`,
      summary: `Tone: ${entry.tone != null ? entry.tone.toFixed(2) : 'n/a'} — ${entry.title || query}`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: entry.date || entry.seendate || null,
      data: {
        tone: entry.tone,
        domain: entry.domain,
        language: entry.language,
        sourcecountry: entry.sourcecountry,
      },
    }));
  }

  async _docSearch(query, options) {
    const url = `${this.baseUrl}/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${options.limit || 10}&timespan=3months&sourcelang=eng`;
    const res = await this._fetch(url, { timeout: 30000 });
    if (!res.ok) return [];

    const articles = res.data?.articles || [];
    return articles.map(a => ({
      url: a.url || '',
      title: a.title || query,
      summary: `${a.title || query} — ${a.domain || 'unknown source'} (${a.seendate || ''})`,
      type: EvidenceType.NEUTRAL,
      timestamp: a.seendate || null,
      data: {
        domain: a.domain,
        language: a.language,
        sourcecountry: a.sourcecountry,
        socialimage: a.socialimage,
      },
    }));
  }
}

export default GeopoliticalConnector;
