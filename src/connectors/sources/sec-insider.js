import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class SECInsiderConnector extends BaseConnector {
  constructor() {
    super({
      id: 'sec_insider',
      name: 'SEC Insider Trading',
      description: 'SEC Form 4 insider trading filings — tracks officer/director stock transactions',
      baseUrl: 'https://efts.sec.gov',
      domains: ['financial'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        forms: '4',
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
          url: `https://www.sec.gov/Archives/edgar/data/${src.entity_id}/${src.file_num || ''}`,
          title: `${src.entity_name || 'Unknown'} — Form 4 (${src.file_date || ''})`,
          summary: `Insider trading filing (Form 4) for ${src.entity_name || query} filed ${src.file_date || 'unknown date'}`,
          type: EvidenceType.NEUTRAL,
          timestamp: src.file_date || null,
          data: {
            formType: 'Form 4',
            entityName: src.entity_name,
            entityId: src.entity_id,
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

export default SECInsiderConnector;
