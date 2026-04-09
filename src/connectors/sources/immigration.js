import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class ImmigrationConnector extends BaseConnector {
  constructor() {
    super({
      id: 'immigration',
      name: 'Immigration Data',
      description: 'Immigration court and case data — TRAC immigration statistics and trends',
      baseUrl: 'https://trac.syr.edu/phptools/immigration',
      domains: ['legal', 'government'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 3000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = [];

      const courtData = await this._searchCourtData(query, options);
      items.push(...courtData);

      if (items.length === 0) {
        const caseStatus = await this._searchCaseStatus(query, options);
        items.push(...caseStatus);
      }

      return this._toEvidence(items.slice(0, options.limit || 10), options.claimId);
    } catch {
      return [];
    }
  }

  async _searchCourtData(query, options) {
    const url = `${this.baseUrl}/court_backlog/apprep_backlog.php?court=&hearing_loc=&judge=&ession=all&nta_charge=&output=json`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const records = Array.isArray(res.data) ? res.data : [];
    const matching = records.filter(r => {
      const text = JSON.stringify(r).toLowerCase();
      return query.toLowerCase().split(/\s+/).some(term => text.includes(term));
    });

    return matching.slice(0, options.limit || 10).map(r => ({
      url: 'https://trac.syr.edu/phptools/immigration/court_backlog/',
      title: `Immigration Court — ${r.court || r.hearing_location || query}`,
      summary: `Court: ${r.court || 'unknown'}, pending cases: ${r.pending || 'N/A'}, avg wait: ${r.avg_days || 'N/A'} days`,
      type: EvidenceType.NEUTRAL,
      timestamp: r.date || r.fiscal_year || null,
      data: r,
    }));
  }

  async _searchCaseStatus(query, options) {
    const url = `https://egov.uscis.gov/casestatus/landing.do`;
    return [{
      url: 'https://egov.uscis.gov/casestatus/landing.do',
      title: `USCIS Case Status — ${query}`,
      summary: `USCIS case status lookup for "${query}" — check egov.uscis.gov directly for case tracking`,
      type: EvidenceType.CONTEXTUAL,
      timestamp: null,
      data: {
        query,
        note: 'USCIS case status requires direct web lookup — programmatic access limited',
        referenceUrl: 'https://egov.uscis.gov/casestatus/landing.do',
        tracUrl: 'https://trac.syr.edu/phptools/immigration/',
      },
    }];
  }
}

export default ImmigrationConnector;
