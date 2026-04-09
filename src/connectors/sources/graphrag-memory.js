import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

const GRAPHRAG_API = process.env.GRAPHRAG_API_URL || 'http://localhost:7800';

/**
 * GraphRAG Memory Connector
 *
 * Queries the shared GraphRAG knowledge service — the cross-system memory
 * built from past doubt investigations, Argus narratives, INNERNET belief
 * maps, TikTalk transcripts, and adversarial epistemics outputs.
 *
 * This is doubt's long-term memory. When investigating a new claim, this
 * connector surfaces what the ecosystem already knows: prior investigations,
 * connected entities, narrative communities, and belief drift signals.
 *
 * Evidence from here is tagged CONTEXTUAL — it is prior analysis, not raw
 * primary data. The adversarial engine should weight it as internal context
 * rather than external corroboration.
 *
 * Prerequisites:
 *   1. Install GraphRAG:    cd shared/graphrag && bash setup.sh
 *   2. Run ingestion:       python3 shared/graphrag/ingestion.py
 *   3. Build index:         graphrag index --root shared/graphrag
 *   4. Start API:           uvicorn api:app --port 7800
 *
 * If the API is not running, this connector silently returns [] with a
 * graceful warning — it will never cause an investigation to fail.
 */

class GraphRAGMemoryConnector extends BaseConnector {
  constructor() {
    super({
      id: 'graphrag_memory',
      name: 'GraphRAG Memory',
      description: 'Long-term cross-system memory — surfaces prior investigations, entity relationships, and narrative communities from the Kali ecosystem. Queries local GraphRAG index.',
      baseUrl: GRAPHRAG_API,
      domains: ['memory', 'general', 'geopolitical', 'news', 'corporate', 'osint'],
      trustTier: SourceTrust.ACADEMIC,   // internal analysis — credible but not primary
      rateMs:    100,                     // local HTTP, very fast
    });
    this._available = null;              // cached availability check
  }

  /**
   * Quick health check — avoids hammering a down API on every query.
   * Cached after the first successful or failed check per session.
   */
  async _isAvailable() {
    if (this._available === true) return true;
    if (this._available === false) return false;

    try {
      const res = await this._fetch(`${this.baseUrl}/health`, { timeout: 2000 });
      this._available = res.ok;
    } catch {
      this._available = false;
    }

    if (!this._available) {
      // Re-check on next investigation — don't permanently cache failure
      setTimeout(() => { this._available = null; }, 60_000);
    }

    return this._available;
  }

  async search(query, options = {}) {
    if (!(await this._isAvailable())) {
      if (process.env.DEBUG_CONNECTORS) {
        console.warn('[graphrag_memory] API unavailable — start with: uvicorn shared/graphrag/api:app --port 7800');
      }
      return [];
    }

    try {
      const results = [];

      // ── Local query: entity-centric — surfaces specific tied entities ──────
      const localRes = await this._fetch(`${this.baseUrl}/query/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          response_type: 'single paragraph',
        }),
        timeout: 15_000,
      });

      if (localRes.ok && localRes.data?.response) {
        const { response, entities_used = [], sources_used = [] } = localRes.data;
        results.push({
          url:     `${this.baseUrl}/query/local`,
          title:   `GraphRAG Local: ${query.slice(0, 80)}`,
          summary: response.slice(0, 800),
          type:    EvidenceType.NEUTRAL,
          timestamp: null,
          data: {
            queryMode:    'local',
            entitiesUsed: entities_used.slice(0, 10),
            sourcesUsed:  sources_used.slice(0, 5),
          },
        });
      }

      // ── Global query: holistic narrative patterns across full corpus ────────
      // Only run for complex queries (>4 words) — expensive and broad
      if (query.split(/\s+/).length > 4) {
        const globalRes = await this._fetch(`${this.baseUrl}/query/global`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            response_type: 'single paragraph',
          }),
          timeout: 20_000,
        });

        if (globalRes.ok && globalRes.data?.response) {
          const { response, community_reports_used = [] } = globalRes.data;
          results.push({
            url:     `${this.baseUrl}/query/global`,
            title:   `GraphRAG Global: ${query.slice(0, 80)}`,
            summary: response.slice(0, 800),
            type:    EvidenceType.NEUTRAL,
            timestamp: null,
            data: {
              queryMode:            'global',
              communityReportsUsed: community_reports_used.slice(0, 5),
            },
          });
        }
      }

      return this._toEvidence(results, options.claimId);
    } catch (err) {
      if (process.env.DEBUG_CONNECTORS) {
        console.error('[graphrag_memory] Search error:', err.message);
      }
      return [];
    }
  }
}

export default GraphRAGMemoryConnector;
