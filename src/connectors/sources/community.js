import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class CommunityConnector extends BaseConnector {
  constructor() {
    super({
      id: 'community',
      name: 'Community Forums',
      description: 'Discourse-based forum search — community discussions, Q&A, announcements',
      baseUrl: 'https://meta.discourse.org',
      domains: ['social'],
      trustTier: SourceTrust.SOCIAL_MEDIA,
      rateMs: 2000,
    });
  }

  async search(query, options = {}) {
    try {
      const forumUrl = options.forumUrl || this.baseUrl;
      const url = `${forumUrl}/search.json?q=${encodeURIComponent(query)}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const topics = res.data?.topics || [];
      const posts = res.data?.posts || [];

      const postMap = new Map();
      for (const p of posts) postMap.set(p.topic_id, p);

      const items = topics.slice(0, options.limit || 10).map(t => {
        const post = postMap.get(t.id);
        const blurb = post?.blurb || t.fancy_title || t.title || '';
        return {
          url: `${forumUrl}/t/${t.slug || t.id}/${t.id}`,
          title: t.fancy_title || t.title || 'Untitled',
          summary: blurb.slice(0, 500),
          type: EvidenceType.CONTEXTUAL,
          timestamp: t.created_at || null,
          data: {
            topicId: t.id,
            slug: t.slug,
            postsCount: t.posts_count,
            replyCount: t.reply_count,
            views: t.views,
            likeCount: t.like_count,
            categoryId: t.category_id,
          },
        };
      });

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default CommunityConnector;
