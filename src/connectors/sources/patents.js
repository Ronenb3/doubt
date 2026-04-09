import { BaseConnector } from '../base.js';
import { getConfig } from '../../core/config.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PatentsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'patents',
      name: 'USPTO PatentsView',
      description: 'US Patent and Trademark Office — patent search by abstract text (requires API key from patentsview.org)',
      baseUrl: 'https://search.patentsview.org',
      domains: ['legal', 'tech'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1400,
      requiresKey: true,
      keyName: 'patentsview',
    });
  }

  async search(query, options = {}) {
    try {
      const apiKey = getConfig().keys?.patentsview;
      if (!apiKey) return [];

      const perPage = options.limit || 10;
      const params = new URLSearchParams({
        q: JSON.stringify({ _text_any: { patent_abstract: query } }),
        f: JSON.stringify([
          'patent_id', 'patent_title', 'patent_abstract',
          'patent_date', 'patent_num_claims',
          'assignees.assignee_organization',
          'inventors.inventor_name_first', 'inventors.inventor_name_last',
        ]),
        s: JSON.stringify([{ patent_date: 'desc' }]),
        per_page: perPage,
      });

      const url = `${this.baseUrl}/api/v1/patent/?${params}`;
      const res = await this._fetch(url, {
        headers: { 'X-Api-Key': apiKey },
      });
      if (!res.ok) return [];

      const patents = res.data?.patents || [];
      const items = patents.map(p => {
        const inventors = (p.inventors || [])
          .map(i => `${i.inventor_name_first || ''} ${i.inventor_name_last || ''}`.trim())
          .filter(Boolean);
        const assignees = (p.assignees || [])
          .map(a => a.assignee_organization)
          .filter(Boolean);

        return {
          url: `https://patents.google.com/patent/US${p.patent_id}`,
          title: p.patent_title || `Patent ${p.patent_id}`,
          summary: (p.patent_abstract || '').slice(0, 250),
          type: EvidenceType.NEUTRAL,
          timestamp: p.patent_date || null,
          data: {
            patentNumber: p.patent_id,
            title: p.patent_title,
            date: p.patent_date,
            numClaims: p.patent_num_claims,
            inventors,
            assignees,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PatentsConnector;
