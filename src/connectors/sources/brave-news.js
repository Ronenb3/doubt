import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

/**
 * Brave Search News Connector
 *
 * Brave Search's News API returns recent news articles from major outlets,
 * ranked by relevance AND freshness. Unlike Google/Bing (paid at scale),
 * Brave offers a free tier: 2,000 queries/month.
 *
 * Key advantage: `freshness=pd` restricts to the past 24 hours,
 * making this the most targeted breaking-news signal in the system.
 *
 * Get a free key at: https://brave.com/search/api/
 * Then set: BRAVE_SEARCH_KEY=BSAxxxx... in your environment.
 *
 * When no key is set, the connector is silently skipped (won't error).
 */

class BraveNewsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'brave_news',
      name: 'Brave Search News',
      description: 'Real-time news search via Brave Search API — fresh, unfiltered, past-24h focus. Requires BRAVE_SEARCH_KEY env var.',
      baseUrl: 'https://api.search.brave.com',
      domains: ['news', 'geopolitical', 'general', 'political', 'technology'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 500,
    });
  }

  async search(query, options = {}) {
    const apiKey = process.env.BRAVE_SEARCH_KEY;
    if (!apiKey) {
      // Silent skip — not an error, just not configured
      return [];
    }

    const limit = Math.min(options.limit || 20, 20);  // API max is 20
    // Default to past week for breaking context; recencyMode tightens to past day
    const freshness = options.recencyMode ? 'pd' : 'pw';

    try {
      const params = new URLSearchParams({
        q: query,
        count: String(limit),
        freshness,
        search_lang: 'en',
        ui_lang: 'en-US',
        text_decorations: '0',
      });

      const url = `${this.baseUrl}/res/v1/news/search?${params}`;
      const res = await this._fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      });

      if (!res.ok) return [];

      const results = res.data?.results || [];

      const items = results
        .filter(r => r.url && r.title)
        .map(r => {
          // page_age is the article publish date — ISO or "N hours ago" string
          let ts = null;
          if (r.page_age) {
            try {
              // Brave returns ISO-ish: "2026-03-01T10:00:00" — sometimes without timezone
              const d = new Date(r.page_age.includes('T') ? r.page_age + 'Z' : r.page_age);
              if (!isNaN(d.getTime())) ts = d.toISOString();
            } catch { ts = null; }
          }

          // Fallback: parse relative age string "3 hours ago", "2 days ago"
          if (!ts && r.age) {
            const now = Date.now();
            const m = r.age.match(/(\d+)\s+(minute|hour|day|week)s?\s+ago/i);
            if (m) {
              const n = parseInt(m[1]);
              const unit = m[2].toLowerCase();
              const ms = unit === 'minute' ? n * 60000
                       : unit === 'hour'   ? n * 3600000
                       : unit === 'day'    ? n * 86400000
                       : unit === 'week'   ? n * 604800000
                       : 0;
              if (ms > 0) ts = new Date(now - ms).toISOString();
            }
          }

          return {
            url: r.url,
            title: r.title || '',
            summary: (r.description || r.title || '').slice(0, 400),
            type: EvidenceType.NEUTRAL,
            timestamp: ts,
            data: {
              age: r.age || null,
              pageAge: r.page_age || null,
              source: r.meta_url?.hostname || null,
              extraSnippets: r.extra_snippets || [],
              ageHours: ts
                ? Math.round((Date.now() - new Date(ts).getTime()) / 3_600_000)
                : null,
            },
          };
        });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default BraveNewsConnector;
