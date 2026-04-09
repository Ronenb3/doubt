/**
 * CORE Research Connector
 *
 * CORE (core.ac.uk) aggregates 200M+ open-access research papers from
 * 10,000+ repositories. Broad humanities + social sciences coverage
 * that complements PubMed/ArXiv's STEM bias.
 *
 * Free API key: https://core.ac.uk/services/api
 * Key name: CORE_API_KEY
 * Without key: 1 req/10s. With key: 10 req/10s.
 * Trust: ACADEMIC_PEER (0.80)
 */

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';
import { getConfig } from '../../core/config.js';

class COREResearchConnector extends BaseConnector {
  constructor() {
    super({
      id: 'core_research',
      name: 'CORE Research',
      description: 'CORE — 200M+ open-access research papers across all disciplines',
      baseUrl: 'https://api.core.ac.uk/v3',
      domains: ['academic', 'general'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 1200,
      requiresKey: false,
      keyName: 'CORE_API_KEY',
    });
  }

  async search(query, options = {}) {
    try {
      const config = getConfig();
      const apiKey = config.keys['CORE_API_KEY'];

      const params = new URLSearchParams({
        q: query,
        limit: String(options.limit || 10),
        sort: 'citationCount:desc',
      });
      if (apiKey) params.set('apiKey', apiKey);

      // CORE v3 redirects HTTP→HTTPS — must follow redirect
      const res = await this._fetch(
        `${this.baseUrl}/search/works?${params}`,
        { redirect: 'follow' }
      );
      if (!res.ok) return [];

      const results = res.data?.results || [];
      const items = results.map(paper => ({
        url: paper.sourceFulltextUrls?.[0] || `https://core.ac.uk/works/${paper.id}`,
        title: paper.title || 'Untitled Paper',
        summary: paper.abstract
          ? paper.abstract.slice(0, 400)
          : `${paper.title || 'Paper'} — ${paper.yearPublished || 'unknown year'}`,
        type: EvidenceType.NEUTRAL,
        timestamp: paper.yearPublished ? `${paper.yearPublished}-01-01` : null,
        data: {
          authors: (paper.authors || []).map(a => a.name),
          yearPublished: paper.yearPublished,
          citationCount: paper.citationCount,
          journal: paper.publisher,
          doi: paper.doi,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default COREResearchConnector;
