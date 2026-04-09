import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FINRAConnector extends BaseConnector {
  constructor() {
    super({
      id: 'finra',
      name: 'FINRA BrokerCheck',
      description: 'FINRA BrokerCheck — broker/adviser registration, disciplinary history, employment',
      baseUrl: 'https://api.brokercheck.finra.org',
      domains: ['financial', 'compliance'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/search/individual?query=${encodeURIComponent(query)}&limit=${options.limit || 10}&start=0`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits?.hits || res.data?.results || [];
      const records = Array.isArray(hits) ? hits : [];
      const items = records.slice(0, options.limit || 10).map(record => {
        const src = record._source || record;
        const name = src.ind_firstname
          ? `${src.ind_firstname} ${src.ind_lastname}`
          : src.name || query;
        return {
          url: `https://brokercheck.finra.org/individual/summary/${src.ind_source_id || src.bc_source_id || ''}`,
          title: `${name} — FINRA BrokerCheck`,
          summary: `${name}: ${src.ind_bc_scope || src.scope || 'registered'} — ${src.ind_current_employers?.[0]?.firm_name || 'unknown firm'}`,
          type: EvidenceType.NEUTRAL,
          timestamp: src.ind_bc_disclosure_fl ? new Date().toISOString() : null,
          data: {
            name,
            crdNumber: src.ind_source_id || src.bc_source_id,
            scope: src.ind_bc_scope || src.scope,
            hasDisclosures: !!src.ind_bc_disclosure_fl,
            currentEmployers: src.ind_current_employers || [],
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default FINRAConnector;
