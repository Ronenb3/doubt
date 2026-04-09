import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class InterpolConnector extends BaseConnector {
  constructor() {
    super({
      id: 'interpol',
      name: 'Interpol Red Notices',
      description: 'Interpol public Red Notice search — international wanted persons',
      baseUrl: 'https://ws-public.interpol.int',
      domains: ['compliance', 'legal'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/notices/v1/red?name=${encodeURIComponent(query)}&resultPerPage=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const notices = res.data?._embedded?.notices || [];
      const items = notices.map(n => {
        const name = [n.forename, n.name].filter(Boolean).join(' ') || 'Unknown';
        return {
          url: n._links?.self?.href || `${this.baseUrl}/notices/v1/red/${n.entity_id}`,
          title: `Interpol Red Notice: ${name}`,
          summary: `${name} — ${n.nationalities?.join(', ') || 'unknown nationality'}, DOB: ${n.date_of_birth || 'unknown'}`,
          type: EvidenceType.NEUTRAL,
          timestamp: n.date_of_birth || null,
          data: {
            entityId: n.entity_id,
            forename: n.forename,
            surname: n.name,
            nationalities: n.nationalities,
            dateOfBirth: n.date_of_birth,
            sex: n.sex_id,
            arrestWarrants: n.arrest_warrants || [],
            thumbnail: n._links?.thumbnail?.href,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default InterpolConnector;
