import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class StateCourtsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'state_courts',
      name: 'State Courts (CourtListener)',
      description: 'State court opinions via CourtListener — case law, rulings, judicial opinions',
      baseUrl: 'https://www.courtlistener.com',
      domains: ['legal'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const url = `${this.baseUrl}/api/rest/v3/search/?q=${encodeURIComponent(query)}&type=o&court=state&format=json`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.slice(0, options.limit || 10).map(r => ({
        url: r.absolute_url ? `${this.baseUrl}${r.absolute_url}` : '',
        title: r.caseName || r.case_name || 'Unknown Case',
        summary: `${r.caseName || r.case_name || 'Case'} — ${r.court || 'state court'} (${r.dateFiled || r.date_filed || ''})`,
        type: EvidenceType.NEUTRAL,
        timestamp: r.dateFiled || r.date_filed || null,
        data: {
          caseId: r.id,
          caseName: r.caseName || r.case_name,
          court: r.court,
          courtCitation: r.court_citation_string,
          dateFiled: r.dateFiled || r.date_filed,
          docketNumber: r.docketNumber || r.docket_number,
          suitNature: r.suitNature || r.nature_of_suit,
          snippet: (r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 500),
          citation: r.citation,
          status: r.status,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default StateCourtsConnector;
