// TikTalk creator discourse connector
// Queries 391 creators, 12,350 transcripts, 856K words via FAISS semantic search
// Trust tier: SOCIAL_MEDIA (0.30) — creator commentary, not primary sources
// Returns what thought leaders / content creators are saying about a topic

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class TikTalkConnector extends BaseConnector {
  constructor() {
    super({
      id: 'tiktalk',
      name: 'TikTalk Creator Corpus',
      description: '391 creator accounts, 856K words of transcript — what content creators are saying',
      baseUrl: 'http://127.0.0.1:8000',
      domains: ['social', 'news', 'general', 'health', 'financial', 'tech'],
      trustTier: SourceTrust.SOCIAL_MEDIA,
      rateMs: 500, // local service
    });
  }

  async search(query, options = {}) {
    try {
      const topK = options.limit || 15;

      // Primary: semantic search across all creators
      const res = await this._fetch(`${this.baseUrl}/api/search/semantic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          top_k: topK,
          filters: { min_score: 0.25 },
        }),
      });

      if (!res.ok) return [];

      // TikTalk returns an array directly (not wrapped in { results: ... })
      const results = Array.isArray(res.data) ? res.data : (res.data?.results || []);
      if (!Array.isArray(results) || results.length === 0) return [];

      const items = results
        .filter(r => r.text && r.text.length > 30)
        .map(r => {
          const username = r.username || 'unknown';
          const textPreview = r.text.length > 80
            ? r.text.slice(0, 80) + '…'
            : r.text;

          return {
            url: r.video_id
              ? `https://www.tiktok.com/@${username}/video/${r.video_id}`
              : `tiktalk://search/${encodeURIComponent(query)}`,
            title: `@${username}: ${textPreview}`,
            summary: r.snippet || r.text,
            type: EvidenceType.CONTEXTUAL,
            timestamp: r.timestamp || null,
            data: {
              username,
              video_id: r.video_id,
              score: r.score,
              segment_id: r.segment_id,
              start_time: r.start_time,
              end_time: r.end_time,
              source_system: 'tiktalk',
            },
          };
        });

      return this._toEvidence(items, options.claimId);
    } catch (err) {
      // TikTalk is optional — graceful degradation when not running
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return [];
      }
      return [];
    }
  }
}

export default TikTalkConnector;
