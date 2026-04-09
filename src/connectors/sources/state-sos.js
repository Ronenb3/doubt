import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class StateSOSConnector extends BaseConnector {
  constructor() {
    super({
      id: 'state_sos',
      name: 'State Secretary of State',
      description: 'US state-level business registration via OpenCorporates US jurisdiction proxy',
      baseUrl: 'https://api.opencorporates.com',
      domains: ['corporate'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
    this._usJurisdictions = [
      'us_de', 'us_ny', 'us_ca', 'us_tx', 'us_fl', 'us_nv', 'us_wa',
      'us_il', 'us_oh', 'us_pa', 'us_ma', 'us_co', 'us_ga', 'us_nc',
    ];
  }

  async search(query, options = {}) {
    try {
      const state = options.state
        ? `us_${options.state.toLowerCase()}`
        : '';
      const jurisdictionFilter = state
        ? `&jurisdiction_code=${state}`
        : `&country_code=us`;

      const url = `${this.baseUrl}/v0.4/companies/search?q=${encodeURIComponent(query)}&format=json&per_page=${options.limit || 10}${jurisdictionFilter}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const companies = res.data?.results?.companies || [];
      const items = companies.slice(0, options.limit || 10).map(({ company: c }) => {
        const stateCode = (c.jurisdiction_code || '').replace('us_', '').toUpperCase();
        return {
          url: c.opencorporates_url || '',
          title: `${c.name || query} — ${stateCode || 'US'} SOS`,
          summary: `${c.name}: ${c.company_type || 'entity'} registered in ${stateCode}, status: ${c.current_status || 'unknown'}, incorporated ${c.incorporation_date || 'N/A'}`,
          type: EvidenceType.NEUTRAL,
          timestamp: c.incorporation_date || c.updated_at || null,
          data: {
            companyNumber: c.company_number,
            jurisdiction: c.jurisdiction_code,
            state: stateCode,
            status: c.current_status,
            companyType: c.company_type,
            incorporationDate: c.incorporation_date,
            registeredAddress: c.registered_address_in_full,
            agent: c.agent_name,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default StateSOSConnector;
