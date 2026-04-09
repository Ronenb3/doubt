import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class BLSConnector extends BaseConnector {
  constructor() {
    super({
      id: 'bls',
      name: 'Bureau of Labor Statistics',
      description: 'BLS economic data — employment, CPI, wages, occupational statistics',
      baseUrl: 'https://api.bls.gov/publicAPI/v2',
      domains: ['economic', 'labor'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const seriesIds = this._queryToSeries(query);
      if (seriesIds.length === 0) return [];

      const url = `${this.baseUrl}/timeseries/data/`;
      const res = await this._fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesid: seriesIds,
          startyear: String(new Date().getFullYear() - 2),
          endyear: String(new Date().getFullYear()),
        }),
      });
      if (!res.ok) return [];

      const seriesResults = res.data?.Results?.series || [];
      const items = seriesResults.flatMap(s => {
        const recent = (s.data || []).slice(0, 3);
        return recent.map(d => ({
          url: `https://data.bls.gov/timeseries/${s.seriesID}`,
          title: `BLS ${s.seriesID}: ${d.periodName || ''} ${d.year || ''}`,
          summary: `${s.seriesID} — ${d.periodName || ''} ${d.year || ''}: ${d.value} (${d.latest === 'true' ? 'latest' : ''})`,
          type: EvidenceType.NEUTRAL,
          timestamp: `${d.year}-${this._periodToMonth(d.period)}-01`,
          data: {
            seriesId: s.seriesID,
            year: d.year,
            period: d.period,
            periodName: d.periodName,
            value: d.value,
            latest: d.latest === 'true',
            footnotes: d.footnotes,
          },
        }));
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _queryToSeries(query) {
    const mapping = {
      'unemployment': ['LNS14000000'],
      'cpi': ['CUUR0000SA0'],
      'inflation': ['CUUR0000SA0'],
      'wages': ['CES0500000003'],
      'employment': ['CES0000000001'],
      'jobs': ['CES0000000001'],
      'nonfarm': ['CES0000000001'],
      'ppi': ['WPUFD49104'],
    };
    const q = query.toLowerCase();
    for (const [key, ids] of Object.entries(mapping)) {
      if (q.includes(key)) return ids;
    }
    return ['LNS14000000'];
  }

  _periodToMonth(period) {
    if (!period) return '01';
    const m = period.replace('M', '');
    return m.padStart(2, '0');
  }
}

export default BLSConnector;
