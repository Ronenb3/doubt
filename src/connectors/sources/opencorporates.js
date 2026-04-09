import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OpenCorporatesConnector extends BaseConnector {
  constructor() {
    super({
      id: 'opencorporates',
      name: 'OpenCorporates',
      description: 'Global corporate registry — company information from 140+ jurisdictions',
      baseUrl: 'https://api.opencorporates.com',
      domains: ['corporate'],
      trustTier: 0.75,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/v0.4/companies/search?q=${encodeURIComponent(query)}&format=json&per_page=${options.limit || 10}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const companies = res.data?.results?.companies || [];
      const items = companies.map(({ company: c }) => ({
        url: c.opencorporates_url || '',
        title: c.name,
        summary: `${c.name} — ${c.company_type || 'company'} in ${c.jurisdiction_code || '?'}, status: ${c.current_status || 'unknown'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: c.incorporation_date || c.updated_at || null,
        data: {
          companyNumber: c.company_number,
          jurisdiction: c.jurisdiction_code,
          status: c.current_status,
          companyType: c.company_type,
          incorporationDate: c.incorporation_date,
          registeredAddress: c.registered_address_in_full,
          dissolutionDate: c.dissolution_date,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default OpenCorporatesConnector;
