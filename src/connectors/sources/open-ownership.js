import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OpenOwnershipConnector extends BaseConnector {
  constructor() {
    super({
      id: 'open_ownership',
      name: 'Open Ownership',
      description: 'Beneficial ownership data — who really owns and controls companies worldwide',
      baseUrl: 'https://api.openownership.org/api/v1',
      domains: ['corporate', 'compliance'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&page_size=${options.limit || 10}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.results || res.data?.data || [];
      const records = Array.isArray(results) ? results : [];
      const items = records.slice(0, options.limit || 10).map(r => ({
        url: r.self_url || r.url || `https://register.openownership.org/entities/${r.id || ''}`,
        title: `${r.name || query} — Beneficial Ownership`,
        summary: `${r.name || query}: ${r.type || 'entity'} — ${r.country || 'unknown jurisdiction'}, ${r.identifiers?.length || 0} identifiers`,
        type: EvidenceType.NEUTRAL,
        timestamp: r.updated_at || r.created_at || null,
        data: {
          name: r.name,
          entityType: r.type,
          country: r.country,
          identifiers: r.identifiers || [],
          relationships: r.relationships?.length || 0,
          address: r.address,
          source: r.source,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default OpenOwnershipConnector;
