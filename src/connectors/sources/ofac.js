import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OFACConnector extends BaseConnector {
  constructor() {
    super({
      id: 'ofac',
      name: 'OFAC Sanctions',
      description: 'US Treasury OFAC sanctions list with OpenSanctions fallback',
      baseUrl: 'https://sanctionssearch.ofac.treas.gov',
      domains: ['compliance', 'sanctions'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = await this._tryTreasury(query);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      const fallbackItems = await this._tryOpenSanctions(query);
      return this._toEvidence(fallbackItems, options.claimId);
    } catch {
      return [];
    }
  }

  async _tryTreasury(query) {
    const url = `${this.baseUrl}/Details.aspx?id=0`;
    const searchUrl = `https://sanctionssearch.ofac.treas.gov/api/search?name=${encodeURIComponent(query)}`;
    const res = await this._fetch(searchUrl);
    if (!res.ok || !Array.isArray(res.data)) return [];

    return res.data.slice(0, 15).map(entry => ({
      url: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${entry.id || 0}`,
      title: entry.name || entry.identity || query,
      summary: `OFAC SDN: ${entry.name || query} — ${entry.type || 'entity'}, program: ${entry.program || 'unknown'}`,
      type: EvidenceType.SUPPORTS,
      timestamp: entry.publishDate || null,
      data: {
        name: entry.name,
        type: entry.type,
        program: entry.program,
        country: entry.country,
        source: 'treasury_ofac',
      },
    }));
  }

  async _tryOpenSanctions(query) {
    const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(query)}&limit=15`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const results = res.data?.results || [];
    return results.map(r => ({
      url: r.id || `https://opensanctions.org/entities/${r.id}`,
      title: r.caption || r.name || query,
      summary: `Sanctions match: ${r.caption || query} — ${r.schema || 'entity'}, datasets: ${(r.datasets || []).join(', ')}`,
      type: EvidenceType.SUPPORTS,
      timestamp: r.first_seen || r.last_seen || null,
      data: {
        caption: r.caption,
        schema: r.schema,
        datasets: r.datasets,
        countries: r.properties?.country,
        score: r.score,
        source: 'opensanctions_fallback',
      },
    }));
  }
}

export default OFACConnector;
