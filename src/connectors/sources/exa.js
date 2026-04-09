import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Exa Neural Search Connector
 *
 * Neural (embedding-based) web search that returns FULL document text,
 * not just snippets. Unlike keyword search, Exa finds semantically
 * related content — useful for claim verification where the exact
 * phrasing doesn't appear in the evidence.
 *
 * Two modes:
 *   - neural (default): embedding similarity search. Best for concepts.
 *   - keyword: exact match. Best for names, numbers, quotes.
 *
 * The full text return is what makes this different: 2000 chars per result
 * means real evidence, not summaries of summaries.
 *
 * Free tier available. Set EXA_API_KEY in environment.
 * docs: https://docs.exa.ai
 */
class ExaConnector extends BaseConnector {
  constructor() {
    super({
      id: 'exa',
      name: 'Exa Neural Search',
      description: 'Neural embedding search returning full document text — finds semantically related evidence, not just keyword matches',
      baseUrl: 'https://api.exa.ai',
      domains: ['academic', 'tech', 'corporate', 'news', 'political', 'health', 'financial', 'geopolitical'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 700,
      requiresKey: false,
      keyName: 'EXA_API_KEY',
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env[this.keyName];
    if (!apiKey) return [];

    try {
      const numResults = Math.min(options.limit || 8, 10);
      const useAutoprompt = options.autoprompt !== false; // default true: Exa rewrites for better neural retrieval

      const payload = {
        query,
        numResults,
        useAutoprompt,
        type: options.searchType || 'neural',
        contents: {
          text: {
            maxCharacters: 2000,
            includeHtmlTags: false,
          },
        },
      };

      // Date filter — useful for temporal investigations
      if (options.startDate) {
        payload.startPublishedDate = options.startDate;
      }
      if (options.endDate) {
        payload.endPublishedDate = options.endDate;
      }

      // Domain filter — e.g. academic sources only
      if (options.includeDomains?.length) {
        payload.includeDomains = options.includeDomains;
      }
      if (options.excludeDomains?.length) {
        payload.excludeDomains = options.excludeDomains;
      }

      const res = await this._fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) return [];
      const data = res.data;

      const items = (data.results || []).map(r => {
        const fullText = r.text || '';
        return {
          url: r.url,
          title: r.title || 'Untitled',
          summary: fullText || r.highlights?.join(' ') || '',
          type: this._inferStance(fullText),
          timestamp: r.publishedDate || null,
          data: {
            exaScore: r.score,
            author: r.author || null,
            domain: this._extractDomain(r.url),
            id: r.id,
            highlights: r.highlights || [],
            fullTextLength: fullText.length,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _inferStance(text) {
    if (!text || text.length < 50) return EvidenceType.CONTEXTUAL;
    const lower = text.toLowerCase();
    const contradictWords = ['false', 'debunked', 'misleading', 'incorrect', 'refuted',
      'no evidence', 'disproven', 'contradicts', 'myth', 'wrong'];
    const supportWords = ['confirms', 'verified', 'evidence supports', 'research shows',
      'data indicates', 'demonstrates', 'proves', 'consistent with'];
    const c = contradictWords.filter(w => lower.includes(w)).length;
    const s = supportWords.filter(w => lower.includes(w)).length;
    if (c > s + 1) return EvidenceType.CONTRADICTS;
    if (s > c + 1) return EvidenceType.SUPPORTS;
    return EvidenceType.CONTEXTUAL;
  }

  _extractDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }
}

export default ExaConnector;
