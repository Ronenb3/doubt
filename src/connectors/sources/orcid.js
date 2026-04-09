import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OrcidConnector extends BaseConnector {
  constructor() {
    super({
      id: 'orcid',
      name: 'ORCID',
      description: 'Researcher identity and publications via ORCID public API',
      baseUrl: 'https://pub.orcid.org',
      domains: ['academic'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/v3.0/search/?q=${encodeURIComponent(query)}`;
      const res = await this._fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];

      const results = res.data?.result || [];
      const items = results.slice(0, options.limit || 10).map(r => {
        const orcid = r['orcid-identifier'];
        const path = orcid?.path || '';
        const uri = orcid?.uri || `https://orcid.org/${path}`;
        return {
          url: uri,
          title: `ORCID: ${path}`,
          summary: `Researcher profile ${path}`,
          type: EvidenceType.CONTEXTUAL,
          timestamp: null,
          data: {
            orcidId: path,
            uri,
            host: orcid?.host,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default OrcidConnector;
