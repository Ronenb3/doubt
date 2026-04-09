import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OpenSanctionsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'opensanctions',
      name: 'OpenSanctions',
      description: 'Aggregated international sanctions, PEPs, and criminal watchlists',
      baseUrl: 'https://api.opensanctions.org',
      domains: ['compliance', 'sanctions'],
      trustTier: 0.85,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/search/default?q=${encodeURIComponent(query)}&limit=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.map(r => {
        const props = r.properties || {};
        return {
          url: `https://opensanctions.org/entities/${r.id}/`,
          title: r.caption || props.name?.[0] || query,
          summary: [
            r.caption,
            r.schema ? `(${r.schema})` : null,
            (r.datasets || []).length ? `datasets: ${r.datasets.join(', ')}` : null,
          ].filter(Boolean).join(' — '),
          type: EvidenceType.SUPPORTS,
          timestamp: r.first_seen || r.last_seen || null,
          data: {
            entityId: r.id,
            schema: r.schema,
            datasets: r.datasets,
            score: r.score,
            countries: props.country,
            topics: props.topics,
            birthDate: props.birthDate,
            nationality: props.nationality,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default OpenSanctionsConnector;
