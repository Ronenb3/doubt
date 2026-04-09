import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class UNComtradeConnector extends BaseConnector {
  constructor() {
    super({
      id: 'un_comtrade',
      name: 'UN Comtrade',
      description: 'International trade data via UN Comtrade API — commodity flows, tariffs',
      baseUrl: 'https://comtradeapi.un.org',
      domains: ['trade', 'geopolitical'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const period = options.period || '2023';
      const url = `${this.baseUrl}/public/v1/preview/C/A/HS?cmdCode=${encodeURIComponent(query)}&period=${period}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const records = res.data?.data || res.data || [];
      if (!Array.isArray(records)) return [];

      const items = records.slice(0, options.limit || 10).map(r => ({
        url: `https://comtradeplus.un.org/TradeFlow?Frequency=A&Flows=X&CommodityCodes=${r.cmdCode || query}`,
        title: `${r.reporterDesc || 'Unknown'} → ${r.partnerDesc || 'World'}: ${r.cmdDescE || query}`,
        summary: `Trade flow: ${r.reporterDesc || '?'} exported $${(r.primaryValue || 0).toLocaleString()} of ${r.cmdDescE || query} (${r.period || period})`,
        type: EvidenceType.NEUTRAL,
        timestamp: r.period ? `${r.period}-01-01` : null,
        data: {
          reporter: r.reporterDesc,
          partner: r.partnerDesc,
          commodity: r.cmdDescE,
          commodityCode: r.cmdCode,
          value: r.primaryValue,
          weight: r.netWgt,
          period: r.period,
          flowDesc: r.flowDesc,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default UNComtradeConnector;
