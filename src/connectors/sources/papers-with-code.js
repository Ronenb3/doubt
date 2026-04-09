import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class PapersWithCodeConnector extends BaseConnector {
  constructor() {
    super({
      id: 'papers_with_code',
      name: 'Papers With Code',
      description: 'ML papers with implementations — benchmarks, SOTA results, code links',
      baseUrl: 'https://paperswithcode.com',
      domains: ['tech', 'academic'],
      trustTier: 0.75,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 10;
      const url = `${this.baseUrl}/api/v1/papers/?q=${encodeURIComponent(query)}&items_per_page=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const papers = res.data?.results || [];
      const items = papers.map(p => ({
        url: p.url_abs || p.paper_url || `${this.baseUrl}${p.url || ''}`,
        title: p.title || 'Untitled',
        summary: (p.abstract || p.title || '').slice(0, 500),
        type: EvidenceType.NEUTRAL,
        timestamp: p.published || null,
        data: {
          arxivId: p.arxiv_id,
          proceeding: p.proceeding,
          authors: p.authors || [],
          tasks: p.tasks || [],
          repositoryUrl: p.repository_url,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default PapersWithCodeConnector;
