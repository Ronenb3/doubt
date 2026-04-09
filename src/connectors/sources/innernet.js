// INNERNET belief/knowledge graph connector
// Optional local connector — queries a personal knowledge graph at localhost:43110.
// Gracefully returns empty results if INNERNET is not running.
// To use: run your own INNERNET instance and point this connector at it.
// See: https://github.com/ronenb3/innernet
// Trust tier: ACADEMIC_PEER (0.80) — curated, structured personal knowledge

import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class InnernetConnector extends BaseConnector {
  constructor() {
    super({
      id: 'innernet',
      name: 'INNERNET Knowledge Graph',
      description: 'Personal knowledge graph — belief context, prior investigations, curated notes',
      baseUrl: 'http://127.0.0.1:43110',
      domains: ['general', 'academic', 'social', 'financial', 'corporate', 'geopolitical'],
      trustTier: SourceTrust.ACADEMIC_PEER,
      rateMs: 200, // local service, fast
    });
  }

  async search(query, options = {}) {
    try {
      const k = options.limit || 10;
      const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&k=${k}`;
      const res = await this._fetch(url);
      if (!res.ok) return [];

      const hits = res.data?.hits || [];
      if (!Array.isArray(hits) || hits.length === 0) return [];

      const items = hits
        .filter(h => h.text && h.text.length > 20)
        .map(hit => ({
          url: `innernet://chunk/${hit.chunk_id || 'unknown'}`,
          title: `INNERNET: ${hit.topics?.[0] || query.slice(0, 60)}`,
          summary: hit.text,
          type: EvidenceType.CONTEXTUAL,
          timestamp: hit.created_at || new Date().toISOString(),
          data: {
            chunk_id: hit.chunk_id,
            score: hit.score,
            topics: hit.topics || [],
            affect: hit.affect || {},
            certainty: hit.affect?.certainty,
            source_system: 'innernet',
          },
        }));

      return this._toEvidence(items, options.claimId);
    } catch (err) {
      // INNERNET is optional — graceful degradation when not running
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return [];
      }
      return [];
    }
  }
}

export default InnernetConnector;
