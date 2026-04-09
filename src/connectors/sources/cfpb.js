import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CFPBConnector extends BaseConnector {
  constructor() {
    super({
      id: 'cfpb',
      name: 'CFPB Complaints',
      description: 'Consumer Financial Protection Bureau complaint database — financial products, company responses',
      baseUrl: 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1',
      domains: ['compliance', 'corporate'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const size = options.limit || 10;
      const url = `${this.baseUrl}/?search_term=${encodeURIComponent(query)}&size=${size}&sort=relevance_desc`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits?.hits || [];
      const items = hits.map(h => {
        const s = h._source || {};
        return {
          url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${s.complaint_id || h._id}`,
          title: `CFPB: ${s.company || 'Unknown'} — ${s.product || 'Financial product'}`,
          summary: `${s.company || 'Company'}: ${s.issue || 'Issue'} (${s.product || ''}) — ${s.date_received || ''}`,
          type: EvidenceType.NEUTRAL,
          timestamp: s.date_received || null,
          data: {
            complaintId: s.complaint_id,
            company: s.company,
            product: s.product,
            subProduct: s.sub_product,
            issue: s.issue,
            subIssue: s.sub_issue,
            state: s.state,
            companyResponse: s.company_response,
            timely: s.timely,
            consumerDisputed: s.consumer_disputed,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CFPBConnector;
