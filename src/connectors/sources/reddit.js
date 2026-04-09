import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class RedditConnector extends BaseConnector {
  constructor() {
    super({
      id: 'reddit',
      name: 'Reddit',
      description: 'Reddit search — community discussions, opinions, and crowd-sourced information',
      baseUrl: 'https://www.reddit.com',
      domains: ['social', 'general'],
      trustTier: SourceTrust.SOCIAL_MEDIA,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = options.limit || 15;
      const sort = options.sort || 'relevance';
      const url = `${this.baseUrl}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const posts = res.data?.data?.children || [];
      const items = posts.map(({ data: p }) => {
        const snippet = p.selftext
          ? p.selftext.slice(0, 200) + (p.selftext.length > 200 ? '…' : '')
          : '';
        return {
          url: `https://www.reddit.com${p.permalink}`,
          title: p.title || 'Untitled',
          summary: snippet || p.title,
          type: EvidenceType.CONTEXTUAL,
          timestamp: p.created_utc
            ? new Date(p.created_utc * 1000).toISOString()
            : null,
          data: {
            subreddit: p.subreddit,
            score: p.score,
            comments: p.num_comments,
            author: p.author,
            selftext: snippet,
            upvoteRatio: p.upvote_ratio,
            domain: p.domain,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default RedditConnector;
