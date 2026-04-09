import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class GovernmentConnector extends BaseConnector {
  constructor() {
    super({
      id: 'government',
      name: 'Data.gov',
      description: 'US government open data via Data.gov CKAN — datasets, metadata, agencies',
      baseUrl: 'https://catalog.data.gov',
      domains: ['government'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const rows = options.limit || 10;
      const url = `${this.baseUrl}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${rows}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.result?.results || [];
      const items = results.map(d => {
        const org = d.organization?.title || d.organization?.name || 'US Government';
        const resources = d.resources || [];
        const mainResource = resources[0];
        return {
          url: mainResource?.url || `${this.baseUrl}/dataset/${d.name || d.id}`,
          title: d.title || d.name || 'Untitled',
          summary: (d.notes || d.title || '').slice(0, 500),
          type: EvidenceType.NEUTRAL,
          timestamp: d.metadata_modified || d.metadata_created || null,
          data: {
            datasetId: d.id,
            organization: org,
            tags: (d.tags || []).map(t => t.display_name || t.name),
            resourceCount: resources.length,
            format: mainResource?.format,
            license: d.license_title,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default GovernmentConnector;
