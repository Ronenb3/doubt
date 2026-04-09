import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class RegulatoryEnforcementConnector extends BaseConnector {
  constructor() {
    super({
      id: 'regulatory_enforcement',
      name: 'Regulatory Enforcement',
      description: 'Aggregate regulatory actions — SEC litigation releases, CFPB complaints, FINRA BrokerCheck',
      baseUrl: 'https://efts.sec.gov',
      domains: ['compliance', 'legal'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      // 1. SEC enforcement actions (litigation releases)
      const secUrl = `${this.baseUrl}/LATEST/search-index?q=${encodeURIComponent(query)}&forms=LIT-REL`;
      const secRes = await this._fetch(secUrl);
      if (secRes.ok) {
        for (const hit of (secRes.data?.hits?.hits || []).slice(0, 5)) {
          const src = hit._source || {};
          items.push({
            url: `https://www.sec.gov/litigation/litreleases/${src.file_num || hit._id}`,
            title: `SEC: ${src.entity_name || 'Unknown'} — ${src.form_type || 'LIT-REL'}`,
            summary: `SEC litigation release: ${src.entity_name || 'Unknown'} (${src.file_date || 'unknown date'})`,
            type: EvidenceType.SUPPORTS,
            timestamp: src.file_date || null,
            trustWeight: 0.95,
            data: {
              source: 'sec_enforcement',
              formType: src.form_type,
              entityName: src.entity_name,
              entityId: src.entity_id,
              fileDate: src.file_date,
              score: hit._score,
            },
          });
        }
      }

      // 2. CFPB consumer complaints
      const cfpbUrl = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?search_term=${encodeURIComponent(query)}&size=5`;
      const cfpbRes = await this._fetch(cfpbUrl);
      if (cfpbRes.ok) {
        for (const hit of (cfpbRes.data?.hits?.hits || []).slice(0, 5)) {
          const src = hit._source || {};
          items.push({
            url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${src.complaint_id || hit._id}`,
            title: `CFPB: ${src.company || 'Unknown'} — ${src.product || 'Complaint'}`,
            summary: [
              `CFPB complaint against ${src.company || 'Unknown'}`,
              src.product ? `Product: ${src.product}` : null,
              src.issue ? `Issue: ${src.issue}` : null,
              src.date_received ? `Received: ${src.date_received}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.SUPPORTS,
            timestamp: src.date_received || null,
            trustWeight: 0.85,
            data: {
              source: 'cfpb',
              complaintId: src.complaint_id,
              company: src.company,
              product: src.product,
              subProduct: src.sub_product,
              issue: src.issue,
              state: src.state,
              companyResponse: src.company_response,
              timely: src.timely,
            },
          });
        }
      }

      // 3. FINRA BrokerCheck (public search)
      const finraUrl = `https://api.brokercheck.finra.org/search/individual?query=${encodeURIComponent(query)}&limit=5`;
      const finraRes = await this._fetch(finraUrl);
      if (finraRes.ok) {
        const hits = finraRes.data?.hits?.hits || finraRes.data?.results || [];
        for (const r of (Array.isArray(hits) ? hits : []).slice(0, 5)) {
          const src = r._source || r;
          const name = src.ind_firstname
            ? `${src.ind_firstname} ${src.ind_lastname}`
            : src.name || query;
          items.push({
            url: `https://brokercheck.finra.org/individual/summary/${src.ind_source_id || r._id || ''}`,
            title: `FINRA: ${name}`,
            summary: [
              `FINRA BrokerCheck: ${name}`,
              src.ind_bc_scope ? `Scope: ${src.ind_bc_scope}` : null,
              src.ind_current_employments?.[0]?.firm_name
                ? `Firm: ${src.ind_current_employments[0].firm_name}` : null,
            ].filter(Boolean).join(' — '),
            type: EvidenceType.NEUTRAL,
            timestamp: null,
            trustWeight: 0.90,
            data: {
              source: 'finra',
              brokerId: src.ind_source_id,
              name,
              scope: src.ind_bc_scope,
              disclosureCount: src.ind_num_of_disclosures,
              currentEmployments: src.ind_current_employments,
            },
          });
        }
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default RegulatoryEnforcementConnector;
