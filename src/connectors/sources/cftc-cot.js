import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CFTCCOTConnector extends BaseConnector {
  constructor() {
    super({
      id: 'cftc_cot',
      name: 'CFTC Commitments of Traders',
      description: 'CFTC COT reports — futures positioning data for commercial and speculative traders',
      baseUrl: 'https://publicreporting.cftc.gov',
      domains: ['financial', 'commodities'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const encoded = encodeURIComponent(query).replace(/%20/g, '%25');
      const url = `${this.baseUrl}/resource/dv4g-nt7k.json?$limit=${options.limit || 10}&$where=market_and_exchange_names%20like%20'%25${encoded}%25'`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const records = Array.isArray(res.data) ? res.data : [];
      const items = records.slice(0, options.limit || 10).map(r => ({
        url: `https://www.cftc.gov/dea/futures/deacmelf.htm`,
        title: `${r.market_and_exchange_names || query} — COT Report`,
        summary: `${r.market_and_exchange_names || query}: commercial long ${r.comm_positions_long_all || 'N/A'}, commercial short ${r.comm_positions_short_all || 'N/A'}, non-commercial long ${r.noncomm_positions_long_all || 'N/A'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: r.report_date_as_yyyy_mm_dd || r.as_of_date_in_form_yymmdd || null,
        data: {
          market: r.market_and_exchange_names,
          reportDate: r.report_date_as_yyyy_mm_dd,
          commercialLong: r.comm_positions_long_all,
          commercialShort: r.comm_positions_short_all,
          nonCommercialLong: r.noncomm_positions_long_all,
          nonCommercialShort: r.noncomm_positions_short_all,
          openInterest: r.open_interest_all,
          changeInOI: r.change_in_open_interest_all,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CFTCCOTConnector;
