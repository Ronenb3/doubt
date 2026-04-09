import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class YouTubeTranscriptConnector extends BaseConnector {
  constructor() {
    super({
      id: 'youtube_transcript',
      name: 'YouTube Search',
      description: 'YouTube video search via official API with Invidious fallback',
      baseUrl: 'https://www.googleapis.com/youtube/v3',
      domains: ['media', 'general'],
      trustTier: SourceTrust.NEWS_MINOR,
      rateMs: 1000,
      requiresKey: false,
    });
    this._invidious = 'https://vid.puffyan.us/api/v1';
  }

  async search(query, options = {}) {
    try {
      const key = process.env.YOUTUBE_API_KEY || '';
      if (key) {
        const results = await this._searchOfficial(query, key, options);
        if (results.length > 0) return results;
      }
      return await this._searchInvidious(query, options);
    } catch {
      return [];
    }
  }

  async _searchOfficial(query, key, options) {
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(options.limit || 5),
      key,
    });
    const url = `${this.baseUrl}/search?${params}`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const videos = res.data?.items || [];
    const items = videos.map(v => ({
      url: `https://www.youtube.com/watch?v=${v.id?.videoId || ''}`,
      title: v.snippet?.title || query,
      summary: (v.snippet?.description || '').slice(0, 200),
      type: EvidenceType.CONTEXTUAL,
      timestamp: v.snippet?.publishedAt || null,
      data: {
        videoId: v.id?.videoId,
        channelTitle: v.snippet?.channelTitle,
        channelId: v.snippet?.channelId,
        publishedAt: v.snippet?.publishedAt,
        thumbnails: v.snippet?.thumbnails,
      },
    }));

    return this._toEvidence(items, options.claimId);
  }

  async _searchInvidious(query, options) {
    const url = `${this._invidious}/search?q=${encodeURIComponent(query)}&type=video`;
    const res = await this._fetch(url);
    if (!res.ok) return [];

    const videos = Array.isArray(res.data) ? res.data : [];
    const items = videos.slice(0, options.limit || 5).map(v => ({
      url: `https://www.youtube.com/watch?v=${v.videoId || ''}`,
      title: v.title || query,
      summary: (v.description || v.descriptionHtml || '').replace(/<[^>]+>/g, '').slice(0, 200),
      type: EvidenceType.CONTEXTUAL,
      timestamp: v.published ? new Date(v.published * 1000).toISOString() : null,
      data: {
        videoId: v.videoId,
        author: v.author,
        authorId: v.authorId,
        viewCount: v.viewCount,
        lengthSeconds: v.lengthSeconds,
        published: v.published,
      },
    }));

    return this._toEvidence(items, options.claimId);
  }
}

export default YouTubeTranscriptConnector;
