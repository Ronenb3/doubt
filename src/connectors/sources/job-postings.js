import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class JobPostingsConnector extends BaseConnector {
  constructor() {
    super({
      id: 'job_postings',
      name: 'Job Postings (HN)',
      description: 'Hacker News Who\'s Hiring search — hiring signals from tech companies',
      baseUrl: 'https://hn.algolia.com/api/v1',
      domains: ['corporate', 'hiring'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({
        query: query,
        tags: 'comment',
        hitsPerPage: String(options.limit || 15),
      });
      const searchQuery = `"who is hiring" ${query}`;
      params.set('query', searchQuery);

      const url = `${this.baseUrl}/search?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits || [];
      const items = hits
        .filter(h => (h.comment_text || '').toLowerCase().includes(query.toLowerCase()))
        .slice(0, options.limit || 10)
        .map(h => ({
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          title: `${this._extractCompany(h.comment_text, query)} — HN Hiring`,
          summary: this._cleanHtml(h.comment_text || '').slice(0, 200),
          type: EvidenceType.CONTEXTUAL,
          timestamp: h.created_at || null,
          data: {
            objectId: h.objectID,
            author: h.author,
            parentId: h.parent_id,
            storyId: h.story_id,
            storyTitle: h.story_title,
            createdAt: h.created_at,
            textPreview: this._cleanHtml(h.comment_text || '').slice(0, 500),
          },
        }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }

  _extractCompany(html, fallback) {
    const text = this._cleanHtml(html || '');
    const match = text.match(/^([^|(\n]{2,40})\s*[|(]/);
    return match ? match[1].trim() : fallback;
  }

  _cleanHtml(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
  }
}

export default JobPostingsConnector;
