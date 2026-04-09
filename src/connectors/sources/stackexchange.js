import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class StackExchangeConnector extends BaseConnector {
  constructor() {
    super({
      id: 'stackexchange',
      name: 'Stack Exchange',
      description: 'Stack Overflow / Stack Exchange — technical Q&A with community scoring',
      baseUrl: 'https://api.stackexchange.com',
      domains: ['tech'],
      trustTier: 0.55,
      rateMs: 1000,
    });
  }

  async search(query, options = {}) {
    try {
      const site = options.site || 'stackoverflow';
      const pagesize = options.limit || 10;
      const params = new URLSearchParams({
        q: query,
        site,
        pagesize: String(pagesize),
        order: 'desc',
        sort: 'relevance',
      });

      const url = `${this.baseUrl}/2.3/search/advanced?${params}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const questions = res.data?.items || [];
      const items = questions.map(q => ({
        url: q.link,
        title: (q.title || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
        summary: `${q.answer_count || 0} answers, score ${q.score || 0} — tags: ${(q.tags || []).join(', ')}`,
        type: EvidenceType.CONTEXTUAL,
        timestamp: q.creation_date
          ? new Date(q.creation_date * 1000).toISOString()
          : null,
        data: {
          questionId: q.question_id,
          score: q.score,
          answerCount: q.answer_count,
          viewCount: q.view_count,
          isAnswered: q.is_answered,
          tags: q.tags,
          owner: q.owner?.display_name,
          acceptedAnswerId: q.accepted_answer_id,
        },
      }));

      return this._toEvidence(items, options.claimId);
    } catch {
      return [];
    }
  }
}

export default StackExchangeConnector;
