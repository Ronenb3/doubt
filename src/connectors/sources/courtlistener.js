import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CourtListenerConnector extends BaseConnector {
  constructor() {
    super({
      id: 'courtlistener',
      name: 'CourtListener',
      description: 'Free Law Project — millions of US court opinions and oral arguments',
      baseUrl: 'https://www.courtlistener.com',
      domains: ['legal'],
      trustTier: SourceTrust.COURT_RECORD,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        type: options.type || 'o',
      });
      if (options.court) params.set('court', options.court);

      const url = `${this.baseUrl}/api/rest/v4/search/?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.map(r => ({
        url: r.absolute_url
          ? `${this.baseUrl}${r.absolute_url}`
          : `${this.baseUrl}/opinion/${r.cluster_id || r.id}/`,
        title: r.caseName || r.case_name || 'Unnamed Case',
        summary: [
          r.caseName || r.case_name,
          r.court ? `Court: ${r.court}` : null,
          r.dateFiled ? `Filed: ${r.dateFiled}` : null,
          r.docketNumber ? `Docket: ${r.docketNumber}` : null,
        ].filter(Boolean).join(' — '),
        type: EvidenceType.NEUTRAL,
        timestamp: r.dateFiled || r.dateArgued || null,
        data: {
          caseName: r.caseName || r.case_name || 'Unnamed Case',
          court: r.court,
          courtId: r.court_id,
          docketNumber: r.docketNumber,
          dateFiled: r.dateFiled,
          dateArgued: r.dateArgued,
          judge: r.judge,
          citeCount: r.citeCount,
          status: r.status,
          suitNature: r.suitNature,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CourtListenerConnector;
