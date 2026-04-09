import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Brave Search Connector
 *
 * Independent web search index — not Google/Bing repackaged.
 * Brave crawls independently, returning raw results with content
 * snippets and freshness signals.
 *
 * Key advantage over DuckDuckGo: returns actual article content,
 * not just title + URL. Published date included when available.
 * No tracking, no filter bubble, reliable uptime.
 *
 * Free tier: 2,000 req/month. Paid: $3/1K after.
 * Set BRAVE_SEARCH_API_KEY in environment.
 * docs: https://api.search.brave.com/app/documentation
 */
class BraveSearchConnector extends BaseConnector {
  constructor() {
    super({
      id: 'brave-search',
      name: 'Brave Search',
      description: 'Independent web search index — raw results with content snippets, no filter bubble',
      baseUrl: 'https://api.search.brave.com/res/v1',
      domains: ['news', 'tech', 'corporate', 'political', 'health', 'social', 'geopolitical', 'academic'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 800,
      requiresKey: false,
      keyName: 'BRAVE_SEARCH_API_KEY',
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env[this.keyName];
    if (!apiKey) return [];

    try {
      const count = Math.min(options.limit || 10, 20);
      const params = new URLSearchParams({
        q: query,
        count: String(count),
        freshness: options.freshness || 'pw', // past week default
        text_decorations: '0',
        spellcheck: '0',
      });

      const res = await this._fetch(`${this.baseUrl}/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      });

      if (!res.ok) return [];
      const data = res.data;
      const results = data.web?.results || [];

      const items = results.map(r => {
        const snippets = r.extra_snippets || [];
        const fullContent = [r.description, ...snippets].filter(Boolean).join(' ');

        return {
          url: r.url,
          title: r.title || query,
          summary: fullContent || r.description || '',
          type: this._inferStance(fullContent),
          timestamp: r.published || r.age || null,
          data: {
            domain: this._extractDomain(r.url),
            language: r.language,
            familyFriendly: r.family_friendly,
            snippetCount: snippets.length,
          },
        };
      });

      // Also surface news results if present
      const newsResults = data.news?.results || [];
      for (const n of newsResults.slice(0, 3)) {
        items.push({
          url: n.url,
          title: n.title || query,
          summary: n.description || '',
          type: EvidenceType.CONTEXTUAL,
          timestamp: n.published || null,
          data: {
            domain: this._extractDomain(n.url),
            isNews: true,
            breaking: n.breaking || false,
          },
        });
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _inferStance(text) {
    if (!text) return EvidenceType.CONTEXTUAL;
    const lower = text.toLowerCase();
    const contradictWords = ['false', 'debunked', 'misleading', 'incorrect', 'wrong', 'refutes', 'no evidence'];
    const supportWords = ['confirmed', 'verified', 'evidence shows', 'research confirms', 'demonstrates'];
    const c = contradictWords.filter(w => lower.includes(w)).length;
    const s = supportWords.filter(w => lower.includes(w)).length;
    if (c > s) return EvidenceType.CONTRADICTS;
    if (s > c) return EvidenceType.SUPPORTS;
    return EvidenceType.CONTEXTUAL;
  }

  _extractDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }
}

export default BraveSearchConnector;
