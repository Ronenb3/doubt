import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class UKCompaniesHouseConnector extends BaseConnector {
  constructor() {
    super({
      id: 'uk_companies_house',
      name: 'UK Companies House',
      description: 'UK Companies House — company profiles, officers, filing history',
      baseUrl: 'https://api.company-information.service.gov.uk',
      domains: ['corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
      requiresKey: true,
      keyName: 'COMPANIES_HOUSE_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const key = process.env.COMPANIES_HOUSE_API_KEY || '';
      const headers = key
        ? { Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}` }
        : {};

      const url = `${this.baseUrl}/search/companies?q=${encodeURIComponent(query)}&items_per_page=${options.limit || 10}`;
      const res = await this._fetch(url, { headers });
      if (!res.ok) return [];

      const companies = res.data?.items || [];
      const items = companies.slice(0, options.limit || 10).map(c => ({
        url: `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}`,
        title: `${c.title || c.company_name || query} — Companies House`,
        summary: `${c.title || c.company_name}: ${c.company_type || 'company'}, status ${c.company_status || 'unknown'}, incorporated ${c.date_of_creation || 'N/A'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: c.date_of_creation || null,
        data: {
          companyNumber: c.company_number,
          companyName: c.title || c.company_name,
          companyType: c.company_type,
          status: c.company_status,
          dateOfCreation: c.date_of_creation,
          address: c.address_snippet || c.registered_office_address,
          sicCodes: c.sic_codes,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default UKCompaniesHouseConnector;
