import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CrossrefConnector extends BaseConnector {
  constructor() {
    super({
      id: 'crossref',
      name: 'Crossref',
      description: 'Scholarly metadata via Crossref — DOIs, citations, publisher data',
      baseUrl: 'https://api.crossref.org',
      domains: ['academic'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const rows = options.limit || 10;
      const url = `${this.baseUrl}/works?query=${encodeURIComponent(query)}&rows=${rows}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const works = res.data?.message?.items || [];
      const items = works.map(w => {
        const title = Array.isArray(w.title) ? w.title[0] : w.title || 'Untitled';
        const issued = w.issued?.['date-parts']?.[0];
        const year = issued?.[0];
        return {
          url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : ''),
          title,
          summary: `${title} (${year || 'n.d.'}) — cited ${w['is-referenced-by-count'] || 0} times`,
          type: EvidenceType.NEUTRAL,
          timestamp: year ? `${year}-${String(issued[1] || 1).padStart(2, '0')}-01` : null,
          data: {
            doi: w.DOI,
            type: w.type,
            publisher: w.publisher,
            citationCount: w['is-referenced-by-count'],
            authors: (w.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()),
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CrossrefConnector;
