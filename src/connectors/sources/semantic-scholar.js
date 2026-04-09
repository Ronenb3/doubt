import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class SemanticScholarConnector extends BaseConnector {
  constructor() {
    super({
      id: 'semantic_scholar',
      name: 'Semantic Scholar',
      description: 'Academic paper search via Semantic Scholar API — titles, abstracts, citations',
      baseUrl: 'https://api.semanticscholar.org',
      domains: ['academic'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const fields = 'title,year,citationCount,url,abstract,authors';
      const url = `${this.baseUrl}/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const papers = res.data?.data || [];
      const items = papers.map(p => ({
        url: p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
        title: p.title || 'Untitled',
        summary: p.abstract || p.title || '',
        type: EvidenceType.NEUTRAL,
        timestamp: p.year ? `${p.year}-01-01` : null,
        data: {
          paperId: p.paperId,
          year: p.year,
          citationCount: p.citationCount,
          authors: (p.authors || []).map(a => a.name),
          abstract: p.abstract,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default SemanticScholarConnector;
