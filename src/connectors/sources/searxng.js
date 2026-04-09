import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * SearXNG Metasearch Connector
 *
 * SearXNG is a self-hosted privacy-respecting metasearch engine that
 * aggregates results from 80+ sources: Google, Bing, DuckDuckGo, Brave,
 * BBC, Guardian, Reuters, Wikipedia, arXiv, GitHub, YouTube, Reddit, and more.
 *
 * This connector queries public SearXNG instances — zero API keys, zero cost.
 * Results are returned with publishedDate when available, making it the
 * highest-information recency signal in the entire connector suite.
 *
 * For breaking news queries (recency mode), this should be the first connector
 * checked — it's the only one guaranteed to surface articles from the past hour.
 *
 * Public instances: https://searx.space
 *
 * If you run your own:  docker run -d -p 8080:8080 searxng/searxng
 * Then set SEARXNG_URL=http://localhost:8080 in env.
 */

// Ranked by reliability and speed. Fallback chain — tries each in order.
const PUBLIC_INSTANCES = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searx.tiekoetter.com',
  'https://searx.work',
  'https://paulgo.io',
  'https://opnxng.com',
];

class SearXNGConnector extends BaseConnector {
  constructor() {
    const baseUrl = process.env.SEARXNG_URL || PUBLIC_INSTANCES[0];
    super({
      id: 'searxng',
      name: 'SearXNG Metasearch',
      description: 'Real-time web + news metasearch aggregating Google/Bing/DuckDuckGo/Reuters/BBC and 80+ sources — zero API key, hours-fresh',
      baseUrl,
      domains: ['news', 'geopolitical', 'general', 'technology', 'political'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1500,
    });
    this._instances = process.env.SEARXNG_URL
      ? [process.env.SEARXNG_URL, ...PUBLIC_INSTANCES]
      : PUBLIC_INSTANCES;
  }

  async search(query, options = {}) {
    const limit = options.limit || 20;
    // For recency queries, prefer news; otherwise use general + news
    const categories = options.recencyMode ? 'news' : 'general,news';

    // Try each instance in order, stop on first success
    for (const instance of this._instances) {
      try {
        const params = new URLSearchParams({
          q: query,
          format: 'json',
          categories,
          language: 'en',
        });

        // Use direct fetch rather than base._fetch to avoid the JSON parse assumption
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        let body;
        try {
          const resp = await fetch(`${instance}/search?${params}`, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'doubt-intelligence-engine/1.0',
            },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!resp.ok) continue;
          body = await resp.json();
        } catch {
          clearTimeout(timer);
          continue;
        }

        const results = body?.results || [];
        if (results.length === 0) continue;  // Try next instance

        const items = results
          .slice(0, limit)
          .filter(r => r.url && r.title)
          .map(r => {
            // SearXNG publishedDate is ISO string or null
            let ts = null;
            if (r.publishedDate) {
              try { ts = new Date(r.publishedDate).toISOString(); } catch { ts = null; }
            }
            return {
              url: r.url,
              title: r.title || '',
              summary: (r.content || r.title || '').slice(0, 400),
              type: EvidenceType.NEUTRAL,
              timestamp: ts,
              data: {
                engine: r.engine || r.engines?.[0] || 'unknown',
                engines: r.engines || [],
                score: r.score,
                category: r.category || categories,
                publishedDate: r.publishedDate || null,
                ageHours: ts
                  ? Math.round((Date.now() - new Date(ts).getTime()) / 3_600_000)
                  : null,
              },
            };
          });

        return this._toEvidence(items, options.claimId);

      } catch {
        // Instance failed entirely — try next
        continue;
      }
    }

    // All instances failed
    return [];
  }
}

export default SearXNGConnector;
