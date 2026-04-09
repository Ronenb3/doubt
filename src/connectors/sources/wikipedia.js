import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class WikipediaConnector extends BaseConnector {
  constructor() {
    super({
      id: 'wikipedia',
      name: 'Wikipedia',
      description: 'Wikipedia article summaries and full-text search for background context',
      baseUrl: 'https://en.wikipedia.org',
      domains: ['general'],
      trustTier: SourceTrust.NEWS_MAJOR,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const items = await this._trySummary(query);
      if (items.length > 0) return this._toEvidence(items, options.claimId);

      const searchItems = await this._searchArticles(query, options.limit || 10);
      return this._toEvidence(searchItems, options.claimId);
    } catch {
      return [];
    }
  }

  async _trySummary(query) {
    const slug = encodeURIComponent(query.replace(/\s+/g, '_'));
    const url = `${this.baseUrl}/api/rest_v1/page/summary/${slug}`;
    const res = await this._fetch(url);
    if (!res.ok || !res.data?.title) return [];

    const d = res.data;
    return [{
      url: d.content_urls?.desktop?.page || `${this.baseUrl}/wiki/${slug}`,
      title: d.title,
      summary: d.extract || d.description || '',
      type: EvidenceType.CONTEXTUAL,
      timestamp: d.timestamp || null,
      data: {
        description: d.description,
        extract: d.extract,
        thumbnail: d.thumbnail?.source,
        pageId: d.pageid,
      },
    }];
  }

  async _searchArticles(query, limit) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
      format: 'json',
      origin: '*',
    });
    const url = `${this.baseUrl}/w/api.php?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const results = res.data?.query?.search || [];
    return results.map(r => ({
      url: `${this.baseUrl}/wiki/${encodeURIComponent(r.title.replace(/\s+/g, '_'))}`,
      title: r.title,
      summary: (r.snippet || '').replace(/<[^>]+>/g, ''),
      type: EvidenceType.CONTEXTUAL,
      timestamp: r.timestamp || null,
      data: {
        pageId: r.pageid,
        wordcount: r.wordcount,
        snippet: (r.snippet || '').replace(/<[^>]+>/g, ''),
      },
    }));
  }
}

export default WikipediaConnector;
