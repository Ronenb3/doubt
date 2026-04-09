import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class SECEdgarConnector extends BaseConnector {
  constructor() {
    super({
      id: 'sec_edgar',
      name: 'SEC EDGAR',
      description: 'SEC full-text search: filings, insider trades (Form 4), institutional holdings (13F)',
      baseUrl: 'https://efts.sec.gov',
      domains: ['financial', 'corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({ q: query });
      if (options.formType) params.set('forms', options.formType);
      if (options.dateRange) {
        if (options.dateRange.start) params.set('dateRange', 'custom');
        if (options.dateRange.start) params.set('startdt', options.dateRange.start);
        if (options.dateRange.end) params.set('enddt', options.dateRange.end);
      }

      const url = `${this.baseUrl}/LATEST/search-index?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits?.hits || [];
      const items = hits.map(hit => {
        const src = hit._source || {};
        return {
          url: `https://www.sec.gov/Archives/edgar/data/${src.entity_id}/${src.file_num || ''}`,
          title: `${src.entity_name || 'Unknown'} — ${src.form_type || 'Filing'} (${src.file_date || ''})`,
          summary: src.entity_name
            ? `${src.form_type || 'Filing'} by ${src.entity_name} filed ${src.file_date || 'unknown date'}`
            : hit._id,
          type: EvidenceType.NEUTRAL,
          timestamp: src.file_date || null,
          data: {
            formType: src.form_type,
            entityName: src.entity_name,
            entityId: src.entity_id,
            fileDate: src.file_date,
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

export default SECEdgarConnector;
