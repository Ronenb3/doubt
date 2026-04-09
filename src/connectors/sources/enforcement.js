import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class EnforcementConnector extends BaseConnector {
  constructor() {
    super({
      id: 'enforcement',
      name: 'SEC Enforcement Actions',
      description: 'SEC enforcement actions and litigation releases — fraud, violations, penalties',
      baseUrl: 'https://efts.sec.gov',
      domains: ['legal', 'compliance'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        forms: 'LIT-REL',
      });
      if (options.dateRange?.start) params.set('startdt', options.dateRange.start);
      if (options.dateRange?.end) params.set('enddt', options.dateRange.end);

      const url = `${this.baseUrl}/LATEST/search-index?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits?.hits || [];
      const items = hits.slice(0, options.limit || 15).map(hit => {
        const src = hit._source || {};
        return {
          url: `https://www.sec.gov/litigation/litreleases/${src.file_num || hit._id || ''}`,
          title: `${src.entity_name || 'Unknown'} — SEC Enforcement (${src.file_date || ''})`,
          summary: `SEC enforcement action against ${src.entity_name || query}: ${src.form_type || 'litigation release'} filed ${src.file_date || 'unknown date'}`,
          type: EvidenceType.CONTRADICTS,
          timestamp: src.file_date || null,
          data: {
            entityName: src.entity_name,
            entityId: src.entity_id,
            formType: src.form_type,
            fileDate: src.file_date,
            fileNum: src.file_num,
            score: hit._score,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default EnforcementConnector;
