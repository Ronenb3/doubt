import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Firecrawl Connector
 *
 * Turns any URL into clean markdown. Firecrawl handles JS rendering,
 * anti-bot evasion, and content extraction — returning structured
 * markdown with no HTML noise.
 *
 * Two modes:
 *   1. scrape(url)  — single URL → clean markdown
 *   2. search(query) — Firecrawl web search → top URLs → clean markdown per result
 *
 * Use case in doubt: when a connector returns a URL that needs deep
 * content extraction (PDFs, JS-rendered pages, paywalled previews),
 * pass it to Firecrawl instead of trying to parse raw HTML.
 *
 * Self-hostable: https://github.com/mendableai/firecrawl
 * Cloud API: https://firecrawl.dev
 * Set FIRECRAWL_API_KEY (or leave unset for self-hosted at FIRECRAWL_URL)
 */
class FirecrawlConnector extends BaseConnector {
  constructor() {
    super({
      id: 'firecrawl',
      name: 'Firecrawl Content Extractor',
      description: 'Converts any URL to clean markdown — JS rendering, anti-bot bypass, structured content extraction',
      baseUrl: process.env.FIRECRAWL_URL || 'https://api.firecrawl.dev',
      domains: ['tech', 'academic', 'corporate', 'news', 'financial', 'legal', 'political', 'health'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 1000,
      requiresKey: false, // optional — works without key on self-hosted
      keyName: 'FIRECRAWL_API_KEY',
    });
  }

  async search(query, options = {}) {
    // If query looks like a URL, scrape it directly
    if (this._isUrl(query)) {
      return this._scrapeUrl(query, options);
    }
    // Otherwise use Firecrawl search mode
    return this._searchMode(query, options);
  }

  async _scrapeUrl(url, options = {}) {
    const apiKey = process.env[this.keyName];
    const baseUrl = process.env.FIRECRAWL_URL || 'https://api.firecrawl.dev';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await this._fetch(`${baseUrl}/v1/scrape`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 1000,
          timeout: 25000,
        }),
      });

      if (!res.ok) return [];
      const data = res.data;
      const content = data.data?.markdown || data.markdown || '';
      if (!content || content.length < 100) return [];

      const metadata = data.data?.metadata || data.metadata || {};
      const items = [{
        url,
        title: metadata.title || metadata.ogTitle || url,
        summary: content.slice(0, 2000),
        type: EvidenceType.CONTEXTUAL,
        timestamp: metadata.publishedTime || null,
        data: {
          fullMarkdown: content,
          wordCount: content.split(/\s+/).length,
          sourceUrl: metadata.sourceURL || url,
          language: metadata.language || null,
          firecrawlExtracted: true,
        },
      }];

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  async _searchMode(query, options = {}) {
    const apiKey = process.env[this.keyName];
    const baseUrl = process.env.FIRECRAWL_URL || 'https://api.firecrawl.dev';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await this._fetch(`${baseUrl}/v1/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          limit: Math.min(options.limit || 5, 10),
          scrapeOptions: {
            formats: ['markdown'],
            onlyMainContent: true,
          },
        }),
      });

      if (!res.ok) return [];
      const data = res.data;
      const results = data.data || data.results || [];

      const items = results
        .filter(r => r.markdown && r.markdown.length > 100)
        .map(r => ({
          url: r.url || r.metadata?.sourceURL || '',
          title: r.metadata?.title || r.metadata?.ogTitle || query,
          summary: r.markdown.slice(0, 2000),
          type: this._inferStance(r.markdown),
          timestamp: r.metadata?.publishedTime || null,
          data: {
            fullMarkdown: r.markdown,
            wordCount: r.markdown.split(/\s+/).length,
            firecrawlExtracted: true,
          },
        }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _isUrl(str) {
    try { new URL(str); return true; } catch { return false; }
  }

  _inferStance(text) {
    if (!text) return EvidenceType.CONTEXTUAL;
    const lower = text.toLowerCase();
    const c = ['false', 'debunked', 'misleading', 'incorrect', 'refuted', 'no evidence'].filter(w => lower.includes(w)).length;
    const s = ['confirmed', 'verified', 'evidence shows', 'research confirms', 'demonstrates'].filter(w => lower.includes(w)).length;
    if (c > s) return EvidenceType.CONTRADICTS;
    if (s > c) return EvidenceType.SUPPORTS;
    return EvidenceType.CONTEXTUAL;
  }
}

export default FirecrawlConnector;
