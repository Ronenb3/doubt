/**
 * HDX Connector — UN Humanitarian Data Exchange
 *
 * OCHA's Humanitarian Data Exchange: crisis data, conflict, displacement,
 * population stats, food security. Fills non-US geopolitical gaps.
 *
 * No API key required.
 * Trust: GOVERNMENT_FILING (0.95) — UN inter-agency official data
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class HDXConnector extends BaseConnector {
  constructor() {
    super({
      id: 'hdx',
      name: 'UN HDX',
      description: 'UN Humanitarian Data Exchange — crisis, conflict, displacement, population data',
      baseUrl: 'https://data.humdata.org',
      domains: ['geopolitical', 'general'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        rows: String(options.limit || 10),
        sort: 'score desc, metadata_modified desc',
      });

      const res = await this._fetch(
        `${this.baseUrl}/api/3/action/package_search?${params}`
      );
      if (!res.ok) return [];

      const results = res.data?.result?.results || [];
      const items = results.map(pkg => ({
        url: `https://data.humdata.org/dataset/${pkg.name}`,
        title: `HDX: ${pkg.title || pkg.name}`,
        summary: pkg.notes
          ? pkg.notes.slice(0, 300)
          : `UN HDX dataset: ${pkg.title}`,
        type: EvidenceType.CONTEXTUAL,
        timestamp: pkg.metadata_modified || pkg.metadata_created || null,
        data: {
          name: pkg.name,
          organization: pkg.organization?.title,
          tags: (pkg.tags || []).map(t => t.name),
          numResources: pkg.num_resources,
          groups: (pkg.groups || []).map(g => g.display_name),
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default HDXConnector;
