import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ProPublicaNonprofitsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'propublica_nonprofits',
      name: 'ProPublica Nonprofits',
      description: 'IRS 990 nonprofit data via ProPublica — revenue, assets, executives, filings',
      baseUrl: 'https://projects.propublica.org/nonprofits/api/v2',
      domains: ['corporate', 'compliance'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 1500,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/search.json?q=${encodeURIComponent(query)}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const orgs = res.data?.organizations || [];
      const items = orgs.slice(0, options.limit || 10).map(o => ({
        url: `https://projects.propublica.org/nonprofits/organizations/${o.ein}`,
        title: `${o.name || 'Unknown Org'} (EIN: ${o.ein || 'N/A'})`,
        summary: `${o.name || 'Org'} — ${o.city || ''}, ${o.state || ''} | Revenue: $${(o.income_amount || 0).toLocaleString()} | Assets: $${(o.asset_amount || 0).toLocaleString()}`,
        type: EvidenceType.NEUTRAL,
        timestamp: o.tax_period ? `${String(o.tax_period).slice(0, 4)}-${String(o.tax_period).slice(4, 6)}-01` : null,
        data: {
          ein: o.ein,
          name: o.name,
          city: o.city,
          state: o.state,
          nteeCode: o.ntee_code,
          income: o.income_amount,
          assets: o.asset_amount,
          revenue: o.revenue_amount,
          subsection: o.subsection_code,
          rulingDate: o.ruling_date,
          taxPeriod: o.tax_period,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default ProPublicaNonprofitsConnector;
