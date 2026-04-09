import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ICIJConnector extends BaseConnector {
  constructor() {
    super({
      id: 'icij',
      name: 'ICIJ Offshore Leaks',
      description: 'International Consortium of Investigative Journalists — offshore leaks database (Panama Papers, Pandora Papers, etc.)',
      baseUrl: 'https://offshoreleaks.icij.org',
      domains: ['corporate', 'compliance'],
      trustTier: 0.85,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = await this._tryAPI(query, options);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      return this._toEvidence([{
        url: `${this.baseUrl}/search?q=${encodeURIComponent(query)}`,
        title: `ICIJ Offshore Leaks search: ${query}`,
        summary: `Search the ICIJ Offshore Leaks Database for "${query}". Covers Panama Papers (2016), Paradise Papers (2017), Pandora Papers (2021), and more. Manual verification recommended at ${this.baseUrl}`,
        type: EvidenceType.CONTEXTUAL,
        timestamp: new Date().toISOString(),
        data: {
          query,
          note: 'ICIJ API may not be publicly available. Visit the web interface for manual search.',
          databases: ['Panama Papers', 'Paradise Papers', 'Pandora Papers', 'Offshore Leaks', 'Bahamas Leaks'],
          webSearchUrl: `${this.baseUrl}/search?q=${encodeURIComponent(query)}`,
        },
      }], options.claimId);
    } catch {
      return [];
    }
  }

  async _tryAPI(query, options) {
    const limit = options.limit || 10;
    const url = `${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await this._fetch(url);
    if (!res.ok || !Array.isArray(res.data)) return [];

    return res.data.map(r => ({
      url: r.url || `${this.baseUrl}/nodes/${r.node_id || r.id || ''}`,
      title: r.name || r.entity || query,
      summary: [
        r.name || r.entity,
        r.jurisdiction ? `jurisdiction: ${r.jurisdiction}` : null,
        r.sourceID ? `source: ${r.sourceID}` : null,
      ].filter(Boolean).join(' — '),
      type: EvidenceType.SUPPORTS,
      timestamp: r.incorporation_date || r.inactivation_date || null,
      data: {
        nodeId: r.node_id || r.id,
        name: r.name || r.entity,
        jurisdiction: r.jurisdiction,
        sourceId: r.sourceID,
        address: r.address,
        countries: r.countries,
        type: r.entity_type || r.type,
      },
    }));
  }
}

export default ICIJConnector;
