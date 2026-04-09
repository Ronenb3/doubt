import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class FDICConnector extends BaseConnector {
  constructor() {
    super({
      id: 'fdic',
      name: 'FDIC BankFind',
      description: 'FDIC bank financial data — institution profiles, financial reports, failure history',
      baseUrl: 'https://banks.data.fdic.gov',
      domains: ['financial'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/api/financials?search=${encodeURIComponent(query)}&limit=${options.limit || 10}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const records = res.data?.data || res.data?.results || [];
      const items = (Array.isArray(records) ? records : []).slice(0, options.limit || 10).map(rec => {
        const d = rec.data || rec;
        return {
          url: `https://www.fdic.gov/analysis/bank-search?CERT=${d.CERT || d.cert || ''}`,
          title: `${d.REPNM || d.INSTNAME || d.name || query} — FDIC`,
          summary: `${d.REPNM || d.INSTNAME || query}: total assets ${d.ASSET || 'N/A'}, total deposits ${d.DEP || 'N/A'}`,
          type: EvidenceType.NEUTRAL,
          timestamp: d.REPDTE || d.date || null,
          data: {
            institutionName: d.REPNM || d.INSTNAME,
            cert: d.CERT || d.cert,
            totalAssets: d.ASSET,
            totalDeposits: d.DEP,
            netIncome: d.NETINC,
            reportDate: d.REPDTE,
            city: d.CITY,
            state: d.STALP || d.STATE,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default FDICConnector;
