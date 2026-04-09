import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Tavily AI Search Connector
 *
 * AI-powered web search that returns synthesized answers + ranked citations.
 * Unlike scraping connectors, Tavily pre-assembles evidence across multiple
 * sources and returns a grounded synthesis — no HTML parsing, no rate-limit
 * gymnastics. The synthesis itself is the evidence.
 *
 * Two layers of output:
 *   1. The synthesized answer (EvidenceType.CONTEXTUAL — overview)
 *   2. Individual citations with relevance scores (SUPPORTS/CONTRADICTS/CONTEXTUAL)
 *
 * Use sonar-style adversarial mode by passing options.adversarial = true:
 *   → prepends "What is the evidence AGAINST: " to the query
 *   → surfaces counter-evidence the standard pipeline might miss
 *
 * Free tier: 1,000 req/month. Set TAVILY_API_KEY in environment.
 * docs: https://docs.tavily.com
 */
class TavilyConnector extends BaseConnector {
  constructor() {
    super({
      id: 'tavily',
      name: 'Tavily AI Search',
      description: 'Synthesized web search with grounded citations — evidence pre-assembled from multiple live sources',
      baseUrl: 'https://api.tavily.com',
      domains: ['news', 'academic', 'tech', 'corporate', 'political', 'financial', 'health', 'geopolitical', 'infrastructure', 'social'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 600,
      requiresKey: false,
      keyName: 'TAVILY_API_KEY',
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env[this.keyName];
    if (!apiKey) return [];

    try {
      const searchQuery = options.adversarial
        ? `What is the strongest evidence AGAINST the claim that: ${query}`
        : query;

      const res = await this._fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: searchQuery,
          search_depth: options.depth || 'advanced',
          include_answer: true,
          include_raw_content: false,
          include_images: false,
          max_results: Math.min(options.limit || 8, 10),
        }),
      });

      if (!res.ok) return [];
      const data = res.data;

      const items = [];

      // Layer 1: the synthesized answer — highest information density
      if (data.answer) {
        items.push({
          url: `https://tavily.com/search?q=${encodeURIComponent(searchQuery)}`,
          title: `Tavily Synthesis: ${query.slice(0, 80)}`,
          summary: data.answer,
          type: options.adversarial ? EvidenceType.CONTRADICTS : EvidenceType.CONTEXTUAL,
          timestamp: new Date().toISOString(),
          data: {
            isSynthesis: true,
            citationCount: data.results?.length || 0,
            followUpQuestions: data.follow_up_questions || [],
            adversarialMode: !!options.adversarial,
          },
        });
      }

      // Layer 2: individual citations with inferred stance
      for (const r of (data.results || [])) {
        const content = r.content || r.snippet || '';
        items.push({
          url: r.url,
          title: r.title || 'Untitled',
          summary: content,
          type: this._inferStance(content, options.adversarial),
          timestamp: r.published_date || null,
          data: {
            tavilyScore: r.score,
            domain: this._extractDomain(r.url),
          },
        });
      }

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _inferStance(text, adversarialMode) {
    if (!text) return EvidenceType.CONTEXTUAL;
    const lower = text.toLowerCase();

    const contradictWords = ['false', 'incorrect', 'wrong', 'debunked', 'misleading',
      'not true', 'no evidence', 'refutes', 'contradicts', 'disputed', 'misinformation'];
    const supportWords = ['confirmed', 'verified', 'true', 'evidence shows',
      'research confirms', 'according to', 'demonstrates', 'proves'];

    const cScore = contradictWords.filter(w => lower.includes(w)).length;
    const sScore = supportWords.filter(w => lower.includes(w)).length;

    if (adversarialMode) {
      return cScore >= sScore ? EvidenceType.CONTRADICTS : EvidenceType.CONTEXTUAL;
    }
    if (cScore > sScore) return EvidenceType.CONTRADICTS;
    if (sScore > cScore) return EvidenceType.SUPPORTS;
    return EvidenceType.CONTEXTUAL;
  }

  _extractDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }
}

export default TavilyConnector;
