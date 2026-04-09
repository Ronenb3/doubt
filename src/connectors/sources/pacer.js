import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PACERConnector extends BaseConnector {
  constructor() {
    super({
      id: 'pacer',
      name: 'PACER / RECAP',
      description: 'Federal court records via RECAP archive on CourtListener (dockets, filings, attachments)',
      baseUrl: 'https://www.courtlistener.com',
      domains: ['legal'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        q: query,
        type: 'r',
        format: 'json',
      });
      if (options.court) params.set('court', options.court);
      if (options.limit) params.set('page_size', String(options.limit));

      const url = `${this.baseUrl}/api/rest/v3/search/?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.map(r => ({
        url: r.absolute_url
          ? `${this.baseUrl}${r.absolute_url}`
          : `${this.baseUrl}/docket/${r.docket_id || r.id}/`,
        title: r.caseName || r.case_name || 'Unnamed Case',
        summary: [
          r.caseName || r.case_name,
          r.court ? `Court: ${r.court}` : null,
          r.dateFiled ? `Filed: ${r.dateFiled}` : null,
          r.docketNumber ? `Docket: ${r.docketNumber}` : null,
          r.description ? r.description.slice(0, 200) : null,
        ].filter(Boolean).join(' — '),
        type: EvidenceType.NEUTRAL,
        timestamp: r.dateFiled || r.dateCreated || null,
        data: {
          docketId: r.docket_id || r.id,
          court: r.court,
          docketNumber: r.docketNumber,
          dateFiled: r.dateFiled,
          dateTerminated: r.dateTerminated,
          description: r.description,
          suitNature: r.suitNature,
          assignedTo: r.assignedTo,
          cause: r.cause,
          pageCount: r.page_count,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PACERConnector;
