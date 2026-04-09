import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GLEIFConnector extends BaseConnector {
  constructor() {
    super({
      id: 'gleif',
      name: 'GLEIF LEI Registry',
      description: 'Global Legal Entity Identifier Foundation — authoritative corporate identity via LEI codes',
      baseUrl: 'https://api.gleif.org',
      domains: ['corporate', 'financial'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/api/v1/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(query)}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const completions = res.data?.data || res.data || [];
      if (!Array.isArray(completions)) return [];

      const items = completions.slice(0, options.limit || 10).map(entry => {
        const entity = entry.attributes?.entity || entry.entity || entry;
        const lei = entry.attributes?.lei || entry.lei || '';
        const name = entity.legalName?.name || entity.legalName || entry.value || query;
        const jurisdiction = entity.jurisdiction || entity.legalJurisdiction || '';
        const status = entity.status || entry.attributes?.registration?.status || '';

        return {
          url: `https://search.gleif.org/#/record/${lei}`,
          title: name,
          summary: `${name} — LEI: ${lei}, jurisdiction: ${jurisdiction}, status: ${status}`,
          type: EvidenceType.NEUTRAL,
          timestamp: entry.attributes?.registration?.lastUpdateDate || null,
          data: {
            lei,
            legalName: name,
            jurisdiction,
            status,
            category: entity.category,
            registeredAddress: entity.legalAddress,
            headquartersAddress: entity.headquartersAddress,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GLEIFConnector;
