import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ComplianceConnector extends BaseConnector {
  constructor() {
    super({
      id: 'compliance',
      name: 'Compliance Aggregator',
      description: 'Aggregate compliance check — OpenSanctions default + OFAC SDN list screening',
      baseUrl: 'https://api.opensanctions.org',
      domains: ['compliance', 'sanctions'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      // 1. OpenSanctions default search
      const limit = options.limit || 10;
      const osUrl = `${this.baseUrl}/search/default?q=${encodeURIComponent(query)}&limit=${limit}`;
      const osRes = await this._fetch(osUrl);
      if (osRes.ok) {
        for (const r of (osRes.data?.results || [])) {
          const props = r.properties || {};
          items.push({
            url: `https://opensanctions.org/entities/${r.id}/`,
            title: r.caption || props.name?.[0] || query,
            summary: [
              r.caption,
              r.schema ? `(${r.schema})` : null,
              (r.datasets || []).length ? `Lists: ${r.datasets.join(', ')}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.SUPPORTS,
            timestamp: r.first_seen || r.last_seen || null,
            trustWeight: 0.90,
            data: {
              source: 'opensanctions',
              entityId: r.id,
              schema: r.schema,
              datasets: r.datasets,
              score: r.score,
              countries: props.country,
              topics: props.topics,
            },
          });
        }
      }

      // 2. OFAC SDN supplementary check (via OpenSanctions OFAC dataset)
      const ofacUrl = `${this.baseUrl}/search/ofac?q=${encodeURIComponent(query)}&limit=5`;
      const ofacRes = await this._fetch(ofacUrl);
      if (ofacRes.ok) {
        for (const r of (ofacRes.data?.results || [])) {
          const props = r.properties || {};
          const alreadyFound = items.some(i => i.data?.entityId === r.id);
          if (alreadyFound) continue;
          items.push({
            url: `https://opensanctions.org/entities/${r.id}/`,
            title: `OFAC: ${r.caption || props.name?.[0] || query}`,
            summary: [
              `OFAC SDN match: ${r.caption}`,
              r.schema ? `(${r.schema})` : null,
              props.country?.length ? `Country: ${props.country.join(', ')}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.SUPPORTS,
            timestamp: r.first_seen || r.last_seen || null,
            trustWeight: 0.95,
            data: {
              source: 'ofac',
              entityId: r.id,
              schema: r.schema,
              datasets: r.datasets,
              score: r.score,
              countries: props.country,
              programs: props.program,
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

export default ComplianceConnector;
