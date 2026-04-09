import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PEPConnector extends BaseConnector {
  constructor() {
    super({
      id: 'pep',
      name: 'PEP Screening',
      description: 'Politically Exposed Persons via OpenSanctions PEP dataset',
      baseUrl: 'https://api.opensanctions.org',
      domains: ['compliance', 'political'],
      trustTier: SourceTrust.FINANCIAL_DATA,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/search/peps?q=${encodeURIComponent(query)}&limit=${limit}`;
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
            props.position?.[0] ? `Position: ${props.position[0]}` : null,
            props.country?.length ? `Country: ${props.country.join(', ')}` : null,
            r.schema ? `(${r.schema})` : null,
          ].filter(Boolean).join(' — '),
          type: EvidenceType.SUPPORTS,
          timestamp: r.first_seen || r.last_seen || null,
          data: {
            entityId: r.id,
            schema: r.schema,
            datasets: r.datasets,
            score: r.score,
            countries: props.country,
            positions: props.position,
            birthDate: props.birthDate,
            nationality: props.nationality,
            politicalParty: props.political,
            education: props.education,
            topics: props.topics,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PEPConnector;
