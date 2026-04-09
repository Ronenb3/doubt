import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class LobbyingConnector extends BaseConnector {
  constructor() {
    super({
      id: 'lobbying',
      name: 'Senate Lobbying Disclosures',
      description: 'Senate LDA lobbying filings — registrant, client, issue, amount',
      baseUrl: 'https://lda.senate.gov/api/v1',
      domains: ['political'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        search: query,
        format: 'json',
      });
      if (options.limit) params.set('page_size', String(options.limit));

      const url = `${this.baseUrl}/filings/?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const results = res.data?.results || res.data || [];
      const filings = Array.isArray(results) ? results : [];
      const items = filings.slice(0, options.limit || 10).map(f => ({
        url: f.url || `https://lda.senate.gov/filings/public/filing/${f.filing_uuid || ''}/`,
        title: `${f.registrant?.name || 'Unknown'} for ${f.client?.name || 'Unknown'} — Lobbying`,
        summary: `${f.registrant?.name || 'Registrant'} lobbied on behalf of ${f.client?.name || 'client'} (${f.filing_year || ''} ${f.filing_period || ''})`,
        type: EvidenceType.NEUTRAL,
        timestamp: f.dt_posted || f.filing_date || null,
        data: {
          filingId: f.filing_uuid,
          registrant: f.registrant?.name,
          client: f.client?.name,
          amount: f.income || f.expenses,
          year: f.filing_year,
          period: f.filing_period,
          lobbyingActivities: f.lobbying_activities?.map(a => a.general_issue_code_display) || [],
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default LobbyingConnector;
