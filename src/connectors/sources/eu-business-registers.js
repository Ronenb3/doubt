import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class EUBusinessRegistersConnector extends BaseConnector {
  constructor() {
    super({
      id: 'eu_registers',
      name: 'EU Business Registers',
      description: 'EU corporate registry data — searches via OpenCorporates EU jurisdictions as proxy',
      baseUrl: 'https://api.opencorporates.com',
      domains: ['corporate'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 2000,
    });
    this._euJurisdictions = [
      'de', 'fr', 'nl', 'be', 'it', 'es', 'pt', 'at', 'ie', 'lu',
      'fi', 'se', 'dk', 'pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'hr',
      'si', 'ee', 'lv', 'lt', 'cy', 'mt', 'el',
    ];
  }

  async search(query, options = {}) {
    try {
      const jurisdiction = options.jurisdiction || '';
      const jurisdictionFilter = jurisdiction
        ? `&jurisdiction_code=${jurisdiction}`
        : `&jurisdiction_code=${this._euJurisdictions.slice(0, 5).join('|')}`;

      const url = `${this.baseUrl}/v0.4/companies/search?q=${encodeURIComponent(query)}&format=json&per_page=${options.limit || 10}${jurisdictionFilter}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const companies = res.data?.results?.companies || [];
      const items = companies.slice(0, options.limit || 10).map(({ company: c }) => ({
        url: c.opencorporates_url || '',
        title: `${c.name || query} — ${(c.jurisdiction_code || '').toUpperCase()} Registry`,
        summary: `${c.name}: ${c.company_type || 'company'} in ${(c.jurisdiction_code || '').toUpperCase()}, status: ${c.current_status || 'unknown'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: c.incorporation_date || c.updated_at || null,
        data: {
          companyNumber: c.company_number,
          jurisdiction: c.jurisdiction_code,
          status: c.current_status,
          companyType: c.company_type,
          incorporationDate: c.incorporation_date,
          registeredAddress: c.registered_address_in_full,
          source: c.source?.publisher,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default EUBusinessRegistersConnector;
